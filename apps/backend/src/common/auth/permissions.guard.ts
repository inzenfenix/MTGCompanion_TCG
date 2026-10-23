import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { AuditService } from '../audit/audit.service';
import { hasPermission, type Permission, type Role } from './permissions';
import { PERMISSIONS_KEY } from './require-permissions.decorator';

interface AuthenticatedRequest {
  user?: { id: string; role: Role };
  method: string;
  route?: { path?: string };
}

/**
 * Authorization half of RBAC (authentication is JwtAuthGuard's job). A
 * denied attempt is written to the audit log before the 403 — a USER
 * probing /admin/* is exactly the kind of thing an ADMIN should be able to
 * see later. The 403 message is deliberately generic: it doesn't say which
 * permission was missing or which roles would have been allowed.
 */
@Injectable()
export class PermissionsGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly audit: AuditService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const required = this.reflector.getAllAndOverride<Permission[] | undefined>(
      PERMISSIONS_KEY,
      [context.getHandler(), context.getClass()],
    );
    if (!required || required.length === 0) return true;

    const req = context.switchToHttp().getRequest<AuthenticatedRequest>();
    const user = req.user;
    // Fail closed: a route that declares permissions but somehow runs
    // without JwtAuthGuard in front of it denies everyone.
    if (!user) throw new ForbiddenException('Insufficient permissions');

    if (required.every((p) => hasPermission(user.role, p))) return true;

    await this.audit.record({
      actorId: user.id,
      actorRole: user.role,
      action: `denied ${req.method} ${req.route?.path ?? ''}`.trim(),
      outcome: 'DENIED',
    });
    throw new ForbiddenException('Insufficient permissions');
  }
}
