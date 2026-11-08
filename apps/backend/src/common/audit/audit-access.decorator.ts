import { SetMetadata } from '@nestjs/common';
import type { RequestUser } from '../../auth/presentation/jwt.strategy';

/**
 * Access logging (ROADMAP.md O17, ACTIVIDAD_7.md §2). Put on a route that
 * reads or changes personal data and AuditAccessInterceptor records one
 * audit row per call — allowed or denied — with *which* resource and *whose*
 * data (as ids the AuditService turns into pseudonyms), never the data.
 */
export interface AuditAccessOptions {
  /** Must be in audit-events.ts (audit-events.spec.ts checks it). */
  action: string;
  resourceType: string;
  /** Route param holding the resource id (resourceRef). */
  param?: string;
  /** Or take the resource id from the handler's result. */
  resourceRef?: (result: unknown) => string | undefined;
  /** Whose personal data it is (raw user id; pseudonymized on write). */
  target?: (
    result: unknown,
    user: RequestUser | undefined,
    req: AuditableRequest,
  ) => string | undefined;
  /** Short code or count for `reason` — never a value of personal data. */
  reason?: (result: unknown, req: AuditableRequest) => string | undefined;
  /** For routes where the actor only exists after the call (registration). */
  actor?: (result: unknown) => string | undefined;
  /** Skip the row entirely when this returns false (e.g. a search with no position). */
  when?: (req: AuditableRequest) => boolean;
}

export const AUDIT_ACCESS = 'audit:access';
export const AuditAccess = (options: AuditAccessOptions) =>
  SetMetadata(AUDIT_ACCESS, options);

/** What a handler can add for the row it is about to produce. */
export interface AuditContext {
  targetId?: string;
  reason?: string;
}

export interface AuditableRequest {
  user?: RequestUser;
  params: Record<string, string>;
  query: Record<string, unknown>;
  auditContext?: AuditContext;
}

/** Lets a handler fill in what only it knows (e.g. the counterparty). */
export function setAuditContext(req: unknown, ctx: AuditContext): void {
  const r = req as AuditableRequest;
  r.auditContext = { ...r.auditContext, ...ctx };
}
