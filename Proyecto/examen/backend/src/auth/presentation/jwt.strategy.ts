import { Injectable, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PassportStrategy } from '@nestjs/passport';
import { ExtractJwt, Strategy } from 'passport-jwt';
import type { AppConfig } from '../../config/configuration';
import type {
  JwtPayload,
  TwoFactorPendingPayload,
} from '../application/auth.service';

export interface RequestUser {
  id: string;
  email: string;
}

@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy) {
  constructor(config: ConfigService<AppConfig, true>) {
    super({
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      ignoreExpiration: false,
      secretOrKey: config.get('auth', { infer: true }).jwtSecret,
    });
  }

  // Whatever this returns becomes req.user — passport-jwt already verified
  // the signature/expiry before this runs, so no DB lookup needed here.
  //
  // Reject 2FA-challenge and listing (J4, QR) tokens explicitly: both are
  // signed with this same secret (so passport-jwt's signature check alone
  // can't tell them apart from a real access token) but must never work as
  // a bearer token on a protected route — each is only valid where its own
  // service verifies the `typ` tag itself, not through this guard.
  validate(
    payload: JwtPayload | TwoFactorPendingPayload | { typ: 'listing' },
  ): RequestUser {
    if (
      'typ' in payload &&
      (payload.typ === '2fa' || payload.typ === 'listing')
    ) {
      throw new UnauthorizedException('Invalid token');
    }
    return { id: payload.sub, email: payload.email };
  }
}
