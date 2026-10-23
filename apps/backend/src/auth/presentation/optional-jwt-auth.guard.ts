import { Injectable } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';

/**
 * For public routes that personalize their answer when a session is
 * present (GET /cards/:cardId/offers' `mine` flag). No/invalid token → the
 * request continues with req.user undefined instead of a 401, so it can
 * never grant more than an anonymous call would get.
 */
@Injectable()
export class OptionalJwtAuthGuard extends AuthGuard('jwt') {
  handleRequest<TUser>(_err: unknown, user: TUser | false): TUser | undefined {
    return user || undefined;
  }
}
