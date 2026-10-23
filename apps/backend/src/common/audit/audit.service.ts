import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import type { Role } from '../auth/permissions';
import { AUDIT_SCOPE, PseudonymService } from '../privacy/pseudonym.service';

export interface AuditEntryInput {
  /** Raw user id — pseudonymized here, never stored as-is. */
  actorId: string;
  actorRole: Role;
  action: string;
  targetId?: string;
  reason?: string;
  outcome: 'ALLOWED' | 'DENIED';
}

export interface AuditEntry {
  id: string;
  actorPseudonym: string;
  actorRole: Role;
  action: string;
  targetPseudonym: string | null;
  reason: string | null;
  outcome: string;
  createdAt: Date;
}

/** Operator actions run from a shell (src/scripts/set-role.ts), not by a logged-in account. */
export const SYSTEM_ACTOR = 'system';

/**
 * Writes the pseudonymized activity log (AuditLog in schema.prisma). The
 * only code path that ever turns a user id into an audit row, so the
 * "never the raw id" rule is enforced in one place. Read access is
 * PermissionsGuard's job (Permission.AUDIT_READ, ADMIN only).
 */
@Injectable()
export class AuditService {
  private readonly logger = new Logger(AuditService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly pseudonyms: PseudonymService,
  ) {}

  pseudonymOf(userId: string): string {
    return userId === SYSTEM_ACTOR
      ? SYSTEM_ACTOR
      : this.pseudonyms.pseudonymize(userId, AUDIT_SCOPE);
  }

  async record(entry: AuditEntryInput): Promise<void> {
    try {
      await this.prisma.auditLog.create({
        data: {
          actorPseudonym: this.pseudonymOf(entry.actorId),
          actorRole: entry.actorRole,
          action: entry.action,
          targetPseudonym: entry.targetId
            ? this.pseudonymOf(entry.targetId)
            : null,
          reason: entry.reason ?? null,
          outcome: entry.outcome,
        },
      });
    } catch (err) {
      // Never let a logging failure turn a denied request into a 500 that
      // leaks more than the 403 would — log the failure (no ids) and move on.
      this.logger.error(
        `audit write failed for "${entry.action}": ${(err as Error).name}`,
      );
    }
  }

  async list(limit: number): Promise<AuditEntry[]> {
    return this.prisma.auditLog.findMany({
      orderBy: { createdAt: 'desc' },
      take: limit,
    });
  }
}
