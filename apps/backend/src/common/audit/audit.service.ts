import { randomUUID } from 'node:crypto';
import { Injectable, Logger } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { PrismaService } from '../../prisma/prisma.service';
import type { Role } from '../auth/permissions';
import {
  AUDIT_RECORDED_EVENT,
  AuditRecordedEvent,
} from '../events/audit-recorded.event';
import { AUDIT_SCOPE, PseudonymService } from '../privacy/pseudonym.service';
import { redactPersonalData } from '../privacy/redact';
import {
  AUDIT_CHAIN_KEY_LABEL,
  ChainVerifier,
  appendChained,
  type ChainVerification,
} from './audit-chain';

export type AuditOutcome = 'ALLOWED' | 'DENIED' | 'FAILED';

export interface AuditEntryInput {
  /** Raw user id (or SYSTEM_ACTOR / ANONYMOUS_ACTOR) — pseudonymized here, never stored as-is. */
  actorId: string;
  /** null only for ANONYMOUS_ACTOR (e.g. a failed login for an email with no account). */
  actorRole: Role | null;
  action: string;
  targetId?: string;
  /** What was touched: "consent", "data-rights-request", "user", "card"… */
  resourceType?: string;
  /** An internal id (request id, purpose code) — never a copy of personal data. */
  resourceRef?: string;
  reason?: string;
  outcome: AuditOutcome;
}

export interface AuditEntry {
  id: string;
  seq: string;
  actorPseudonym: string;
  actorRole: Role | null;
  action: string;
  targetPseudonym: string | null;
  resourceType: string | null;
  resourceRef: string | null;
  reason: string | null;
  outcome: string;
  createdAt: Date;
  hash: string | null;
}

/** Operator actions run from a shell (src/scripts/set-role.ts), not by a logged-in account. */
export const SYSTEM_ACTOR = 'system';
/** Requests with no account behind them (failed login for an unknown email). */
export const ANONYMOUS_ACTOR = 'anonymous';

const VERIFY_BATCH = 1000;

/**
 * Writes the pseudonymized, hash-chained activity log (AuditLog in
 * schema.prisma). The only code path that ever turns a user id into an
 * audit row, so the "never the raw id" rule — and the "never a password,
 * token or personal value" rule (ACTIVIDAD_5.md §3.3) — is enforced in one
 * place. Read access is PermissionsGuard's job (Permission.AUDIT_READ,
 * ADMIN only).
 */
@Injectable()
export class AuditService {
  private readonly logger = new Logger(AuditService.name);
  private readonly chainKey: Buffer;

  constructor(
    private readonly prisma: PrismaService,
    private readonly pseudonyms: PseudonymService,
    private readonly events: EventEmitter2,
  ) {
    this.chainKey = pseudonyms.deriveKey(AUDIT_CHAIN_KEY_LABEL);
  }

  pseudonymOf(userId: string): string {
    return userId === SYSTEM_ACTOR || userId === ANONYMOUS_ACTOR
      ? userId
      : this.pseudonyms.pseudonymize(userId, AUDIT_SCOPE);
  }

  async record(entry: AuditEntryInput): Promise<void> {
    const actorPseudonym = this.pseudonymOf(entry.actorId);
    const targetPseudonym = entry.targetId
      ? this.pseudonymOf(entry.targetId)
      : null;
    try {
      const row = {
        id: randomUUID(),
        createdAt: new Date(),
        actorPseudonym,
        actorRole: entry.actorRole,
        action: entry.action,
        targetPseudonym,
        resourceType: entry.resourceType ?? null,
        resourceRef: entry.resourceRef ?? null,
        // Defense in depth: reasons come from validated DTOs (NoContactInfo)
        // or from code, but a log is the last place an email or a token
        // should end up, so mask anything that slipped through.
        reason: entry.reason ? redactPersonalData(entry.reason) : null,
        outcome: entry.outcome,
      };
      await appendChained(this.prisma, this.chainKey, row);
    } catch (err) {
      // Never let a logging failure turn a denied request into a 500 that
      // leaks more than the 403 would — log the failure (no ids) and move on.
      this.logger.error(
        `audit write failed for "${entry.action}": ${(err as Error).name}`,
      );
      return;
    }
    try {
      await this.events.emitAsync(
        AUDIT_RECORDED_EVENT,
        new AuditRecordedEvent(
          entry.action,
          entry.outcome,
          entry.actorId,
          actorPseudonym,
          targetPseudonym,
        ),
      );
    } catch (err) {
      this.logger.error(
        `detection failed after "${entry.action}": ${(err as Error).name}`,
      );
    }
  }

  async list(limit: number): Promise<AuditEntry[]> {
    const rows = await this.prisma.auditLog.findMany({
      orderBy: { seq: 'desc' },
      take: limit,
      omit: { prevHash: true },
    });
    // seq is a BigInt, which JSON can't carry — string it.
    return rows.map((r) => ({ ...r, seq: r.seq.toString() }));
  }

  /** Recomputes the whole chain (GET /admin/security/audit/verify; scripts/incident-snapshot.ts does the same). */
  async verifyChain(): Promise<ChainVerification> {
    const verifier = new ChainVerifier(this.chainKey);
    let cursor: bigint | undefined;
    for (;;) {
      const batch = await this.prisma.auditLog.findMany({
        where: {
          hash: { not: null },
          ...(cursor !== undefined ? { seq: { gt: cursor } } : {}),
        },
        orderBy: { seq: 'asc' },
        take: VERIFY_BATCH,
      });
      for (const row of batch) {
        if (!verifier.feed(row)) return verifier.result;
      }
      if (batch.length < VERIFY_BATCH) return verifier.result;
      cursor = batch[batch.length - 1].seq;
    }
  }
}
