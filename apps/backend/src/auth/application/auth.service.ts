import { createHash, randomBytes } from 'node:crypto';
import { Inject, Injectable, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import ms from 'ms';
import type { AppConfig } from '../../config/configuration';
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
  ) {}

  async login(dto: LoginDto): Promise<LoginResult | TwoFactorChallengeResult> {
    const user = await this.users.validateCredentials(dto.email, dto.password);
    if (!user) {
      // Same message for "no such email" and "wrong password" — see the
      // comment on UsersService.validateCredentials for why.
      throw new UnauthorizedException('Invalid email or password');
    }

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

    const valid = await this.users.verifyTwoFactorCode(payload.sub, code);
    if (!valid) {
      throw new UnauthorizedException('Invalid two-factor code');
    }

    const user = await this.users.findById(payload.sub);
    if (!user) {
      throw new UnauthorizedException(
        'Invalid or expired two-factor challenge',
      );
    }
    return this.issueLoginResult(user);
  }

  private async issueLoginResult(user: UserResponseDto): Promise<LoginResult> {
    const accessToken = this.signAccessToken(user.id, user.email);
    const refreshToken = await this.issueRefreshToken(user.id);
    return { accessToken, refreshToken, user };
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

    const user = await this.users.findById(stored.userId);
    // Shouldn't normally happen — onDelete: Cascade removes a user's
    // refresh tokens when the user itself is deleted — but don't sign a
    // fresh access token for a user that turned out not to exist.
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
