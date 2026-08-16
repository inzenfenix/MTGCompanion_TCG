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
  // Reject 2FA-challenge tokens explicitly: they're signed with this same
  // secret (so passport-jwt's signature check alone can't tell them apart
  // from a real access token) but must never work as a bearer token on a
  // protected route — only POST /auth/2fa/verify accepts them, and it
  // verifies the `typ` tag itself rather than going through this guard.
  validate(payload: JwtPayload | TwoFactorPendingPayload): RequestUser {
    if ('typ' in payload && payload.typ === '2fa') {
      throw new UnauthorizedException('Invalid token');
    }
    return { id: payload.sub, email: (payload as JwtPayload).email };
  }
}
