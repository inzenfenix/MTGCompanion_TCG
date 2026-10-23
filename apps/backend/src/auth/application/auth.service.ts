import { createHash, randomBytes, randomUUID } from 'node:crypto';
import {
  BadRequestException,
  Inject,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import ms from 'ms';
import type { AppConfig } from '../../config/configuration';
import {
  ANONYMOUS_ACTOR,
  AuditService,
} from '../../common/audit/audit.service';
import type { Role } from '../../common/auth/permissions';
import { UsersService } from '../../users/application/users.service';
import type { UserResponseDto } from '../../users/presentation/dto/user-response.dto';
import {
  REFRESH_TOKEN_REPOSITORY,
  type RefreshTokenRepository,
} from '../domain/refresh-token.repository';
import type { LoginDto } from '../presentation/dto/login.dto';

export interface JwtPayload {
  sub: string; // userId
  email: string;
  iat?: number; // set by jsonwebtoken — compared with User.sessionsRevokedAt (O15)
}

/**
 * Step-up re-authentication (ROADMAP.md O15, ACTIVIDAD_5.md §2.1): proof
 * that the person holding a session *right now* knows the password (and
 * the TOTP code, when 2FA is on). Required for the riskiest rights requests
 * — exporting everything, changing the email, erasing the account — so a
 * stolen access token alone isn't enough. 5 minutes, one use: the jti is
 * stored @unique on the request that consumes it. JwtStrategy rejects
 * `typ: 'step-up'`, so it can't be used as a bearer token either.
 */
export interface StepUpPayload {
  sub: string;
  typ: 'step-up';
  jti: string;
  amr: StepUpMethod;
}
export type StepUpMethod = 'password' | 'password+totp';
export const STEP_UP_TTL_SECONDS = 300;

export interface StepUpResult {
  stepUpToken: string;
  method: StepUpMethod;
  expiresIn: number;
}

// Signed with the same secret as a real access token but deliberately
// shaped differently (no `email`, carries `typ`) — JwtStrategy rejects any
// payload with `typ === '2fa'` so this can never double as a bearer token
// on a protected route, only as the argument to POST /auth/2fa/verify.
export interface TwoFactorPendingPayload {
  sub: string; // userId
  typ: '2fa';
}

const TWO_FACTOR_TOKEN_TTL = '5m';

export interface LoginResult {
  accessToken: string;
  refreshToken: string;
  user: UserResponseDto;
}

// Returned instead of LoginResult when the account has 2FA enabled —
// caller must follow up with POST /auth/2fa/verify to get real tokens.
export interface TwoFactorChallengeResult {
  twoFactorRequired: true;
  twoFactorToken: string;
}

export interface RefreshResult {
  accessToken: string;
  refreshToken: string;
}

@Injectable()
export class AuthService {
  constructor(
    private readonly users: UsersService,
    private readonly jwt: JwtService,
    private readonly config: ConfigService<AppConfig, true>,
    @Inject(REFRESH_TOKEN_REPOSITORY)
    private readonly refreshTokens: RefreshTokenRepository,
    private readonly audit: AuditService,
  ) {}

  async login(dto: LoginDto): Promise<LoginResult | TwoFactorChallengeResult> {
    const check = await this.users.checkCredentials(dto.email, dto.password);
    if (!check.ok) {
      // Audited (O15) with the account's pseudonym when there is one —
      // that's what SecurityService counts to detect brute force — and
      // never with the email typed in. The response stays the same generic
      // 401 for every reason, so it doesn't reveal which emails exist or
      // that an account is locked.
      await this.audit.record({
        actorId: check.userId ?? ANONYMOUS_ACTOR,
        actorRole: check.role,
        action: 'auth.login',
        reason: check.reason,
        outcome: check.reason === 'bad-password' ? 'FAILED' : 'DENIED',
      });
      throw new UnauthorizedException('Invalid email or password');
    }
    const user = check.user;

    if (user.settings.twoFactorEnabled) {
      const twoFactorToken = this.jwt.sign(
        { sub: user.id, typ: '2fa' } satisfies TwoFactorPendingPayload,
        { expiresIn: TWO_FACTOR_TOKEN_TTL },
      );
      return { twoFactorRequired: true, twoFactorToken };
    }

    return this.issueLoginResult(user);
  }

  // Second step of a 2FA login: exchanges the short-lived challenge token +
  // a current TOTP code for the real access/refresh pair. Verifies the
  // token manually (not via JwtAuthGuard) since a `typ:'2fa'` payload is
  // exactly what that guard is built to reject.
  async verifyTwoFactor(
    twoFactorToken: string,
    code: string,
  ): Promise<LoginResult> {
    let payload: TwoFactorPendingPayload;
    try {
      payload = this.jwt.verify<TwoFactorPendingPayload>(twoFactorToken);
    } catch {
      throw new UnauthorizedException(
        'Invalid or expired two-factor challenge',
      );
    }
    if (payload.typ !== '2fa') {
      throw new UnauthorizedException(
        'Invalid or expired two-factor challenge',
      );
    }

    const user = await this.users.findById(payload.sub);
    // Disabled/erased between the two steps → same answer as a bad challenge.
    const ctx = await this.users.findAuthContext(payload.sub);
    if (!user || !ctx) {
      throw new UnauthorizedException(
        'Invalid or expired two-factor challenge',
      );
    }

    const valid = await this.users.verifyTwoFactorCode(payload.sub, code);
    if (!valid) {
      await this.audit.record({
        actorId: user.id,
        actorRole: user.role,
        action: 'auth.2fa',
        outcome: 'FAILED',
      });
      throw new UnauthorizedException('Invalid two-factor code');
    }
    return this.issueLoginResult(user);
  }

  private async issueLoginResult(user: UserResponseDto): Promise<LoginResult> {
    const accessToken = this.signAccessToken(user.id, user.email);
    const refreshToken = await this.issueRefreshToken(user.id);
    await this.audit.record({
      actorId: user.id,
      actorRole: user.role,
      action: 'auth.login',
      outcome: 'ALLOWED',
    });
    return { accessToken, refreshToken, user };
  }

  /** POST /auth/step-up — see StepUpPayload. */
  async stepUp(
    actor: { id: string; role: Role },
    password: string,
    code?: string,
  ): Promise<StepUpResult> {
    const user = await this.users.findById(actor.id);
    const fail = async (reason: string) => {
      await this.audit.record({
        actorId: actor.id,
        actorRole: actor.role,
        action: 'auth.step-up',
        reason,
        outcome: 'FAILED',
      });
      throw new UnauthorizedException('Re-authentication failed');
    };
    if (!user) return fail('no-account');
    if (!(await this.users.verifyPassword(actor.id, password))) {
      return fail('bad-password');
    }
    let method: StepUpMethod = 'password';
    if (user.settings.twoFactorEnabled) {
      // Proportional to risk: an account that chose 2FA gets the same bar
      // here as at login.
      if (!code) {
        throw new BadRequestException('Two-factor code required');
      }
      if (!(await this.users.verifyTwoFactorCode(actor.id, code))) {
        return fail('bad-2fa-code');
      }
      method = 'password+totp';
    }
    const payload: StepUpPayload = {
      sub: actor.id,
      typ: 'step-up',
      jti: randomUUID(),
      amr: method,
    };
    await this.audit.record({
      actorId: actor.id,
      actorRole: actor.role,
      action: 'auth.step-up',
      reason: method,
      outcome: 'ALLOWED',
    });
    return {
      stepUpToken: this.jwt.sign(payload, { expiresIn: STEP_UP_TTL_SECONDS }),
      method,
      expiresIn: STEP_UP_TTL_SECONDS,
    };
  }

  /**
   * Validates a step-up token for `userId`. Returns its jti so the caller can
   * store it (single use) — or null if it's missing, expired, forged or
   * belongs to a different account.
   */
  checkStepUp(
    token: string | undefined,
    userId: string,
  ): { jti: string; method: StepUpMethod } | null {
    if (!token) return null;
    try {
      const p = this.jwt.verify<StepUpPayload>(token);
      if (p.typ !== 'step-up' || p.sub !== userId || !p.jti) return null;
      return { jti: p.jti, method: p.amr };
    } catch {
      return null;
    }
  }

  // Rotates on every use: the presented token is deleted and a fresh one
  // issued in its place, so replaying an already-used refresh token fails
  // outright instead of silently working — see the RefreshToken model
  // comment in schema.prisma for the full rationale.
  async refresh(rawToken: string): Promise<RefreshResult> {
    const stored = await this.refreshTokens.findByHash(
      this.hashToken(rawToken),
    );
    if (!stored) {
      throw new UnauthorizedException('Invalid or expired refresh token');
    }
    await this.refreshTokens.deleteById(stored.id); // consume it either way — expired or not, it's single-use

    if (stored.expiresAt < new Date()) {
      throw new UnauthorizedException('Invalid or expired refresh token');
    }

    // findAuthContext, not findById: a disabled or erased account (O15)
    // can't refresh its way back in either.
    const user = await this.users.findAuthContext(stored.userId);
    if (!user) {
      throw new UnauthorizedException('Invalid or expired refresh token');
    }

    const accessToken = this.signAccessToken(user.id, user.email);
    const refreshToken = await this.issueRefreshToken(user.id);
    return { accessToken, refreshToken };
  }

  private signAccessToken(userId: string, email: string): string {
    const payload: JwtPayload = { sub: userId, email };
    return this.jwt.sign(payload);
  }

  private async issueRefreshToken(userId: string): Promise<string> {
    const raw = randomBytes(64).toString('hex');
    const refreshTtl = this.config.get('auth', { infer: true }).refreshTtl;
    const expiresAt = new Date(Date.now() + ms(refreshTtl as ms.StringValue));
    await this.refreshTokens.create({
      tokenHash: this.hashToken(raw),
      userId,
      expiresAt,
    });
    return raw;
  }

  // sha256, not bcrypt: this hashes a 512-bit random token (all entropy,
  // nothing to brute-force offline the way a human password would need
  // slowing down for), not a low-entropy user secret.
  private hashToken(raw: string): string {
    return createHash('sha256').update(raw).digest('hex');
  }
}
