import { Injectable } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';

/** Requires a valid `Authorization: Bearer <token>` — delegates to JwtStrategy. */
@Injectable()
export class JwtAuthGuard extends AuthGuard('jwt') {}
