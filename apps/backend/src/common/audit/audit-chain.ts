import { createHmac, timingSafeEqual } from 'node:crypto';
import type { PrismaClient } from '../../../generated/prisma';
import type { Role } from '../auth/permissions';

/**
 * Tamper evidence for the audit log (ROADMAP.md O15, ACTIVIDAD_5.md §3.4).
 *
 *   hash(n) = HMAC-SHA256(chainKey, hash(n-1) ␟ id ␟ createdAt ␟ actor ␟ … ␟ outcome)
 *
 * The DB trigger already rejects UPDATE/DELETE, but the table owner can
 * drop a trigger. The chain covers that case: changing any field of a row,
 * deleting one from the middle or inserting a forged one breaks every hash
 * after it, and recomputing them needs the key, which only the backend
 * process holds (derived from PSEUDONYM_KEY, never stored in the database).
 */

export const AUDIT_CHAIN_KEY_LABEL = 'audit-log-chain-v1';

export interface ChainedFields {
  id: string;
  createdAt: Date;
  actorPseudonym: string;
  actorRole: Role | null;
  action: string;
  targetPseudonym: string | null;
  resourceType: string | null;
  resourceRef: string | null;
  reason: string | null;
  outcome: string;
}

const SEP = '\u001f'; // ASCII unit separator — can't appear in any field value we write

export function computeAuditHash(
  key: Buffer,
  prevHash: string | null,
  row: ChainedFields,
): string {
  const payload = [
    prevHash ?? '',
    row.id,
    row.createdAt.toISOString(),
    row.actorPseudonym,
    row.actorRole ?? '',
    row.action,
    row.targetPseudonym ?? '',
    row.resourceType ?? '',
    row.resourceRef ?? '',
    row.reason ?? '',
    row.outcome,
  ].join(SEP);
  return createHmac('sha256', key).update(payload).digest('hex');
}

// Any constant works as long as every writer uses the same one: it
// serializes appends so two concurrent writers can't both link to the same
// previous hash.
const AUDIT_CHAIN_LOCK_ID = 4_015_015;

/**
 * Appends one row at the end of the chain. Shared by AuditService and the
 * operator scripts (purge-expired-data, incident tooling), which run
 * outside Nest but must extend the same chain.
 */
export async function appendChained(
  prisma: PrismaClient,
  key: Buffer,
  row: ChainedFields,
): Promise<void> {
  await prisma.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(${AUDIT_CHAIN_LOCK_ID})`;
    const last = await tx.auditLog.findFirst({
      where: { hash: { not: null } },
      orderBy: { seq: 'desc' },
      select: { hash: true },
    });
    const prevHash = last?.hash ?? null;
    await tx.auditLog.create({
      data: { ...row, prevHash, hash: computeAuditHash(key, prevHash, row) },
    });
  });
}

export interface ChainRow extends ChainedFields {
  seq: bigint;
  prevHash: string | null;
  hash: string | null;
}

export interface ChainVerification {
  ok: boolean;
  checked: number;
  firstSeq: string | null;
  lastSeq: string | null;
  /** First row where the chain fails, and why. */
  brokenAt?: { seq: string; problem: 'hash-mismatch' | 'link-mismatch' };
}

/**
 * Walks rows in seq order. The first chained row is accepted as the anchor
 * whatever its prevHash says, because retention (purge-expired-data) deletes
 * the oldest rows — the purge itself is logged, so a moved anchor is
 * explained in the log. Stateful so the caller can feed it in batches.
 */
export class ChainVerifier {
  private prev: string | null = null;
  private started = false;
  readonly result: ChainVerification = {
    ok: true,
    checked: 0,
    firstSeq: null,
    lastSeq: null,
  };

  constructor(private readonly key: Buffer) {}

  /** Returns false (and stops accepting rows) at the first broken row. */
  feed(row: ChainRow): boolean {
    if (!this.result.ok || !row.hash) return this.result.ok;
    const seq = row.seq.toString();
    if (this.started && row.prevHash !== this.prev) {
      return this.fail(seq, 'link-mismatch');
    }
    const expected = computeAuditHash(this.key, row.prevHash, row);
    if (!safeEqualHex(expected, row.hash)) {
      return this.fail(seq, 'hash-mismatch');
    }
    if (!this.started) this.result.firstSeq = seq;
    this.started = true;
    this.prev = row.hash;
    this.result.checked++;
    this.result.lastSeq = seq;
    return true;
  }

  private fail(seq: string, problem: 'hash-mismatch' | 'link-mismatch') {
    this.result.ok = false;
    this.result.brokenAt = { seq, problem };
    return false;
  }
}

function safeEqualHex(a: string, b: string): boolean {
  const ba = Buffer.from(a, 'hex');
  const bb = Buffer.from(b, 'hex');
  return ba.length === bb.length && timingSafeEqual(ba, bb);
}
