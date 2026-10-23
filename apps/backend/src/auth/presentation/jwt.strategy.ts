import { Injectable, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PassportStrategy } from '@nestjs/passport';
import { ExtractJwt, Strategy } from 'passport-jwt';
import type { AppConfig } from '../../config/configuration';
import type { Role } from '../../common/auth/permissions';
import { UsersService } from '../../users/application/users.service';
import type {
  JwtPayload,
  StepUpPayload,
  TwoFactorPendingPayload,
} from '../application/auth.service';

export interface RequestUser {
  id: string;
  email: string;
  role: Role;
}

@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy) {
  constructor(
    config: ConfigService<AppConfig, true>,
    private readonly users: UsersService,
  ) {
    super({
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      ignoreExpiration: false,
      secretOrKey: config.get('auth', { infer: true }).jwtSecret,
    });
  }

  // Whatever this returns becomes req.user — passport-jwt already verified
  // the signature/expiry before this runs. The role is deliberately NOT a
  // token claim (ROADMAP.md O14): it's re-read from the database here on
  // every request, so demoting an ADMIN or deleting an account takes effect
  // immediately instead of lasting until the access token expires (15 min).
  //
  // Reject 2FA-challenge and listing (J4, QR) tokens explicitly: both are
  // signed with this same secret (so passport-jwt's signature check alone
  // can't tell them apart from a real access token) but must never work as
  // a bearer token on a protected route — each is only valid where its own
  // service verifies the `typ` tag itself, not through this guard.
  //
  // O15: same for step-up tokens, and an access token issued before the
  // account's sessionsRevokedAt (containment, email change) is dead even
  // though its signature and expiry are fine. Compared in whole seconds
  // (iat has no milliseconds), so a login in the same second as the
  // revocation still works.
  async validate(
    payload:
      | JwtPayload
      | TwoFactorPendingPayload
      | StepUpPayload
      | { typ: 'listing'; sub: string },
  ): Promise<RequestUser> {
    if ('typ' in payload) {
      throw new UnauthorizedException('Invalid token');
    }
    const user = await this.users.findAuthContext(payload.sub);
    if (!user) throw new UnauthorizedException('Invalid token');
    if (
      user.sessionsRevokedAt &&
      (payload.iat ?? 0) < Math.floor(user.sessionsRevokedAt.getTime() / 1000)
    ) {
      throw new UnauthorizedException('Invalid token');
    }
    return { id: user.id, email: user.email, role: user.role };
  }
}
