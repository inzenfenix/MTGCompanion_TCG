import {
  CallHandler,
  ExecutionContext,
  HttpException,
  Injectable,
  NestInterceptor,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { catchError, from, mergeMap, Observable, throwError } from 'rxjs';
import {
  AUDIT_ACCESS,
  type AuditAccessOptions,
  type AuditableRequest,
} from './audit-access.decorator';
import { ANONYMOUS_ACTOR, AuditService } from './audit.service';

const DENIAL_REASON: Record<number, string> = {
  400: 'bad-request',
  401: 'unauthorized', // thrown by the handler (wrong code), not the guard
  403: 'forbidden',
  404: 'not-found',
  409: 'conflict',
};

/**
 * Global (AuditModule, APP_INTERCEPTOR) and a no-op on routes without
 * @AuditAccess. Runs after the guards, so a request without a valid
 * session (401) never reaches it — those are covered by auth.login.
 *
 * Outcomes:
 *   ALLOWED  the handler returned
 *   DENIED   401 / 403 / 404 / 409 / 400 — someone asked for data they don't get
 *            (the enumeration alert counts these). Other errors (5xx) are
 *            not access decisions and aren't recorded here.
 * The audit write is awaited before the response leaves, so the row exists
 * by the time the client sees the result.
 */
@Injectable()
export class AuditAccessInterceptor implements NestInterceptor {
  constructor(
    private readonly reflector: Reflector,
    private readonly audit: AuditService,
  ) {}

  intercept(ctx: ExecutionContext, next: CallHandler): Observable<unknown> {
    const opts = this.reflector.get<AuditAccessOptions | undefined>(
      AUDIT_ACCESS,
      ctx.getHandler(),
    );
    if (!opts || ctx.getType() !== 'http') return next.handle();
    const req = ctx.switchToHttp().getRequest<AuditableRequest>();
    if (opts.when && !opts.when(req)) return next.handle();

    return next.handle().pipe(
      mergeMap((result: unknown) =>
        from(this.write(opts, req, 'ALLOWED', result)).pipe(
          mergeMap(() => [result]),
        ),
      ),
      catchError((err: unknown) => {
        const status = err instanceof HttpException ? err.getStatus() : 500;
        const reason = DENIAL_REASON[status];
        if (!reason) return throwError(() => err);
        return from(this.write(opts, req, 'DENIED', undefined, reason)).pipe(
          mergeMap(() => throwError(() => err)),
        );
      }),
    );
  }

  private async write(
    opts: AuditAccessOptions,
    req: AuditableRequest,
    outcome: 'ALLOWED' | 'DENIED',
    result: unknown,
    denial?: string,
  ) {
    const user = req.user;
    const actorId =
      (outcome === 'ALLOWED' ? opts.actor?.(result) : undefined) ??
      user?.id ??
      ANONYMOUS_ACTOR;
    const ctxt = req.auditContext ?? {};
    const resourceRef =
      (opts.param ? req.params?.[opts.param] : undefined) ??
      (outcome === 'ALLOWED' ? opts.resourceRef?.(result) : undefined);
    await this.audit.record({
      actorId,
      actorRole:
        user?.role ?? (opts.actor && outcome === 'ALLOWED' ? 'USER' : null),
      action: opts.action,
      targetId:
        ctxt.targetId ??
        (outcome === 'ALLOWED' ? opts.target?.(result, user, req) : undefined),
      resourceType: opts.resourceType,
      resourceRef,
      reason:
        denial ??
        ctxt.reason ??
        (outcome === 'ALLOWED' ? opts.reason?.(result, req) : undefined),
      outcome,
    });
  }
}
