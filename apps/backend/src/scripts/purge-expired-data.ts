/**
 * Retention (ROADMAP.md O14/O15, docs/security/ACTIVIDAD_4.md §1 and
 * ACTIVIDAD_5.md §3.5): deletes data that has outlived its purpose instead
 * of keeping it "just in case".
 *
 *   - refresh_tokens past expiresAt — single-use and already unusable, but
 *     each row still links a user id to a login time.
 *   - user_settings locations older than LOCATION_TTL_DAYS (default 30) —
 *     search already ignores them (PrismaCardRepository), this erases them.
 *   - (O15) audit_logs, CLOSED data_rights_requests and CLOSED/DISMISSED
 *     security_alerts older than AUDIT_RETENTION_DAYS (default 730, never
 *     below 365 — the audit trigger enforces that floor itself). Audit rows
 *     can only be deleted here: the trigger requires the session flag this
 *     script sets, and the purge is itself appended to the hash chain.
 *
 *   npm run db:purge-expired
 *
 * Idempotent. docker-entrypoint.sh runs it (compiled, dist/scripts/) on
 * every container start, next to encrypt-existing-fields. Prints counts only.
 */
import { randomUUID } from 'node:crypto';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '../../generated/prisma';
import configuration from '../config/configuration';
import {
  AUDIT_CHAIN_KEY_LABEL,
  appendChained,
} from '../common/audit/audit-chain';
import { SYSTEM_ACTOR } from '../common/audit/audit.service';
import { PseudonymService } from '../common/privacy/pseudonym.service';

const DAY = 24 * 60 * 60 * 1000;
/** Mirrors the floor in the audit_logs trigger (migration 20261023180000). */
export const MIN_AUDIT_RETENTION_DAYS = 365;

export interface RetentionOptions {
  auditRetentionDays?: number;
  /** When given, the audit purge is recorded in the hash chain. */
  auditChainKey?: Buffer;
}

export async function purgeExpiredData(
  prisma: PrismaClient,
  locationTtlDays: number,
  now: Date = new Date(),
  options: RetentionOptions = {},
) {
  const tokens = await prisma.refreshToken.deleteMany({
    where: { expiresAt: { lt: now } },
  });
  const cutoff = new Date(now.getTime() - locationTtlDays * DAY);
  const locations = await prisma.userSettings.updateMany({
    where: { locationUpdatedAt: { lt: cutoff } },
    data: {
      shareLocation: false,
      lastLat: null,
      lastLng: null,
      locationUpdatedAt: null,
    },
  });

  const retentionDays = Math.max(
    options.auditRetentionDays ?? 730,
    MIN_AUDIT_RETENTION_DAYS,
  );
  const recordsCutoff = new Date(now.getTime() - retentionDays * DAY);
  const auditLogs = await prisma.$transaction(async (tx) => {
    // Transaction-local (third argument true): the flag dies with this
    // transaction, so no other statement on this connection inherits it.
    await tx.$executeRaw`SELECT set_config('app.audit_retention_purge', 'on', true)`;
    await tx.$executeRaw`SELECT set_config('app.audit_retention_days', ${String(retentionDays)}, true)`;
    return tx.auditLog.deleteMany({
      where: { createdAt: { lt: recordsCutoff } },
    });
  });
  const requests = await prisma.dataRightsRequest.deleteMany({
    where: { status: 'CLOSED', closedAt: { lt: recordsCutoff } },
  });
  const alerts = await prisma.securityAlert.deleteMany({
    where: {
      status: { in: ['CLOSED', 'DISMISSED'] },
      updatedAt: { lt: recordsCutoff },
    },
  });

  if (options.auditChainKey && auditLogs.count > 0) {
    await appendChained(prisma, options.auditChainKey, {
      id: randomUUID(),
      createdAt: new Date(),
      actorPseudonym: SYSTEM_ACTOR,
      actorRole: null,
      action: 'audit.retention.purge',
      targetPseudonym: null,
      resourceType: 'audit-log',
      resourceRef: null,
      reason: `${auditLogs.count} row(s) older than ${retentionDays} days`,
      outcome: 'ALLOWED',
    });
  }

  return {
    refreshTokens: tokens.count,
    locations: locations.count,
    auditLogs: auditLogs.count,
    rightsRequests: requests.count,
    securityAlerts: alerts.count,
    retentionDays,
  };
}

async function main() {
  const { database, privacy, security } = configuration();
  if (!database.url) throw new Error('DATABASE_URL is not set');
  const prisma = new PrismaClient({
    adapter: new PrismaPg({ connectionString: database.url }),
  });
  try {
    const counts = await purgeExpiredData(
      prisma,
      privacy.locationTtlDays,
      new Date(),
      {
        auditRetentionDays: security.auditRetentionDays,
        auditChainKey: privacy.pseudonymKey
          ? new PseudonymService(privacy.pseudonymKey).deriveKey(
              AUDIT_CHAIN_KEY_LABEL,
            )
          : undefined,
      },
    );
    console.log(
      `retention: deleted ${counts.refreshTokens} expired refresh token(s), ` +
        `erased ${counts.locations} location(s) older than ${privacy.locationTtlDays} days, ` +
        `${counts.auditLogs} audit row(s), ${counts.rightsRequests} closed request(s) and ` +
        `${counts.securityAlerts} closed alert(s) older than ${counts.retentionDays} days.`,
    );
  } finally {
    await prisma.$disconnect();
  }
}

if (require.main === module) {
  main().catch((err) => {
    console.error(err instanceof Error ? err.message : err);
    process.exit(1);
  });
}
