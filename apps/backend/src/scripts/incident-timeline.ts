/**
 * Incident reconstruction from the audit log, offline (ROADMAP.md O17,
 * ACTIVIDAD_7.md §6) — same result as GET /admin/security/incidents/
 * :alertId/timeline, for when the API is down or is itself the suspect:
 *
 *   npm run incident:timeline -- --alert <alertId> [--before 24] [--after 24] [--out file.md] [--json file.json]
 *
 * Verifies the whole hash chain first (with the key derived from
 * PSEUDONYM_KEY), then reads the rows around the alert and prints the
 * phase-by-phase timeline (security/domain/incident-timeline.ts). Read-only,
 * except for one chained audit row recording that the log was consulted.
 * Output carries pseudonyms only.
 */
import { randomUUID } from 'node:crypto';
import { writeFileSync } from 'node:fs';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '../../generated/prisma';
import {
  AUDIT_CHAIN_KEY_LABEL,
  ChainVerifier,
  appendChained,
} from '../common/audit/audit-chain';
import { PseudonymService } from '../common/privacy/pseudonym.service';
import configuration from '../config/configuration';
import {
  buildIncidentTimeline,
  renderTimelineMarkdown,
  type IncidentTimeline,
} from '../security/domain/incident-timeline';

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

export async function reconstructIncident(
  prisma: PrismaClient,
  chainKey: Buffer,
  alertId: string,
  hoursBefore = 24,
  hoursAfter = 24,
): Promise<IncidentTimeline> {
  const alert = await prisma.securityAlert.findUnique({
    where: { id: alertId },
  });
  if (!alert) throw new Error(`alert ${alertId} not found`);
  const H = 60 * 60 * 1000;
  const window = {
    from: new Date(alert.createdAt.getTime() - hoursBefore * H),
    to: new Date(alert.createdAt.getTime() + hoursAfter * H),
  };

  const verifier = new ChainVerifier(chainKey);
  for (const row of await prisma.auditLog.findMany({
    where: { hash: { not: null } },
    orderBy: { seq: 'asc' },
  })) {
    if (!verifier.feed(row)) break;
  }

  const subject = alert.subjectPseudonym;
  const rows = await prisma.auditLog.findMany({
    where: {
      createdAt: { gte: window.from, lte: window.to },
      OR: [
        ...(subject
          ? [{ actorPseudonym: subject }, { targetPseudonym: subject }]
          : []),
        { resourceRef: alert.id },
      ],
    },
    orderBy: { seq: 'asc' },
    omit: { prevHash: true, hash: true },
  });
  const timeline = buildIncidentTimeline({
    alert,
    rows: rows.map((r) => ({ ...r, seq: r.seq.toString() })),
    chain: verifier.result,
    window,
  });

  await appendChained(prisma, chainKey, {
    id: randomUUID(),
    createdAt: new Date(),
    actorPseudonym: 'system',
    actorRole: null,
    action: 'admin.incident.timeline',
    targetPseudonym: null,
    resourceType: 'security-alert',
    resourceRef: alert.id,
    reason: `${timeline.summary.events} rows, chain ${verifier.result.ok ? 'ok' : 'BROKEN'} (offline script)`,
    outcome: 'ALLOWED',
  });
  return timeline;
}

async function main() {
  const alertId = arg('alert');
  if (!alertId)
    throw new Error(
      'Usage: incident-timeline --alert <id> [--before h] [--after h] [--out file.md] [--json file.json]',
    );
  const { database, privacy } = configuration();
  if (!database.url) throw new Error('DATABASE_URL is not set');
  if (!privacy.pseudonymKey)
    throw new Error('PSEUDONYM_KEY is not set (needed to verify the chain)');
  const prisma = new PrismaClient({
    adapter: new PrismaPg({ connectionString: database.url }),
  });
  try {
    const key = new PseudonymService(privacy.pseudonymKey).deriveKey(
      AUDIT_CHAIN_KEY_LABEL,
    );
    const t = await reconstructIncident(
      prisma,
      key,
      alertId,
      Number(arg('before') ?? 24),
      Number(arg('after') ?? 24),
    );
    const md = renderTimelineMarkdown(t);
    const out = arg('out');
    if (out) writeFileSync(out, md);
    else console.log(md);
    const json = arg('json');
    if (json) writeFileSync(json, JSON.stringify(t, null, 2));
  } finally {
    await prisma.$disconnect();
  }
}

if (require.main === module) {
  main().catch((err: unknown) => {
    console.error((err as Error).message);
    process.exit(1);
  });
}
