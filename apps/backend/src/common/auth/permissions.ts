/**
 * RBAC model (ROADMAP.md O14, docs/security/ACTIVIDAD_4.md §3) — the single
 * source of truth for "which role may do what". Routes declare the
 * permission they need with @RequirePermissions(); PermissionsGuard checks
 * it against the caller's role, which JwtStrategy re-reads from the database
 * on every request (so demoting someone takes effect immediately, not when
 * their access token expires).
 *
 * Least privilege: a permission not listed for a role is denied — there is
 * no wildcard and no implicit inheritance. Self-service actions on one's own
 * data (own cards, own transactions, own location...) aren't permissions
 * here: they're ownership checks inside each service/repository, the same
 * for every role. Nothing grants access to cryptographic keys — there is no
 * endpoint for them at all (they live in AWS Secrets Manager / env, and
 * only the backend process reads them).
 */

// Mirrors the Prisma `Role` enum (schema.prisma) — kept as a plain union so
// domain/application code doesn't depend on Prisma-generated types.
export const ROLES = ['USER', 'SUPPORT', 'ADMIN'] as const;
export type Role = (typeof ROLES)[number];

export enum Permission {
  /** List accounts (id, display name, role, masked email). */
  USERS_LIST = 'users:list',
  /** Promote/demote another account. */
  ROLES_MANAGE = 'roles:manage',
  /** Read another user's transactions — only with a stated reason, always audited. */
  TRANSACTIONS_READ_ANY = 'transactions:read:any',
  /** Read the (pseudonymized) audit log. */
  AUDIT_READ = 'audit:read',
  /** Anonymized, aggregated sales report. */
  REPORTS_READ = 'reports:read',
  /** Re-link an audit-log pseudonym to an account — with a stated reason, audited. */
  PSEUDONYM_RESOLVE = 'pseudonym:resolve',
  /** Track data-subject requests and their legal deadlines (O15) — pseudonymized, no request contents. */
  DATA_REQUESTS_READ = 'data-requests:read',
  /** Security alerts + containment: revoke sessions, disable/enable accounts (O15, incident response plan). */
  INCIDENT_RESPONSE = 'security:incident',
}

export const ROLE_PERMISSIONS: Readonly<Record<Role, readonly Permission[]>> = {
  USER: [],
  // "Personal autorizado": resolves disputes between buyer and seller, so it
  // may see who bought what (with a reason) and find the accounts involved
  // — but it can't change roles, read the audit log, run reports or undo
  // pseudonyms. O15: it also follows up data-subject requests (deadlines),
  // but can't run incident containment.
  SUPPORT: [
    Permission.USERS_LIST,
    Permission.TRANSACTIONS_READ_ANY,
    Permission.DATA_REQUESTS_READ,
  ],
  ADMIN: [
    Permission.USERS_LIST,
    Permission.ROLES_MANAGE,
    Permission.TRANSACTIONS_READ_ANY,
    Permission.AUDIT_READ,
    Permission.REPORTS_READ,
    Permission.PSEUDONYM_RESOLVE,
    Permission.DATA_REQUESTS_READ,
    Permission.INCIDENT_RESPONSE,
  ],
};

export function hasPermission(role: Role, permission: Permission): boolean {
  return ROLE_PERMISSIONS[role]?.includes(permission) ?? false;
}
