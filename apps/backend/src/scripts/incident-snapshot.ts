/**
 * Evidence preservation (ROADMAP.md O15, ACTIVIDAD_5.md §4.3 — "cómo se
 * evitará destruir evidencias durante la contención"). Run it FIRST, before
 * any containment step that changes state:
 *
 *   npm run incident:snapshot -- --out ./evidence [--since 2026-10-01]
 *
 * Writes, into a new timestamped folder:
 *   audit_logs.json          every audit row since --since (default: all)
 *   security_alerts.json     every alert since --since
 *   chain_verification.json  the hash-chain check at snapshot time
 *   manifest.json            SHA-256 of each file + who/when — hash the
 *                            manifest itself and note it in the incident
 *                            ticket, and any later edit to the folder shows.
 * Read-only on the database, except for one audit row recording that a
 * snapshot was taken. The output holds pseudonyms, not identities: it can
 * be handed to whoever investigates without disclosing who the players are.
 */
import { createHash, randomUUID } from 'node:crypto';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '../../generated/prisma';
import configuration from '../config/configuration';
import {
  AUDIT_CHAIN_KEY_LABEL,
  ChainVerifier,
  appendChained,
} from '../common/audit/audit-chain';
import { PseudonymService } from '../common/privacy/pseudonym.service';

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

// BigInt (seq) isn't JSON — write it as a string.
const json = (v: unknown) =>
  JSON.stringify(
    v,
    (_k, x: unknown) => (typeof x === 'bigint' ? x.toString() : x),
    2,
  );

export async function takeSnapshot(
  prisma: PrismaClient,
  chainKey: Buffer,
  outRoot: string,
  since?: Date,
): Promise<{ dir: string; manifestSha256: string }> {
  const createdAt = since ? { gte: since } : undefined;
  const [logs, alerts, chained] = await Promise.all([
    prisma.auditLog.findMany({ where: { createdAt }, orderBy: { seq: 'asc' } }),
    prisma.securityAlert.findMany({
      where: { createdAt },
      orderBy: { createdAt: 'asc' },
    }),
    prisma.auditLog.findMany({
      where: { hash: { not: null } },
      orderBy: { seq: 'asc' },
    }),
  ]);
  const verifier = new ChainVerifier(chainKey);
  for (const row of chained) if (!verifier.feed(row)) break;

  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const dir = resolve(outRoot, `incident-${stamp}`);
  mkdirSync(dir, { recursive: true });
  const files: Record<string, string> = {
    'audit_logs.json': json(logs),
    'security_alerts.json': json(alerts),
    'chain_verification.json': json(verifier.result),
  };
  const manifest = {
    takenAt: new Date().toISOString(),
    since: since?.toISOString() ?? null,
    rows: { auditLogs: logs.length, securityAlerts: alerts.length },
    chainOk: verifier.result.ok,
    sha256: {} as Record<string, string>,
  };
  for (const [name, content] of Object.entries(files)) {
    writeFileSync(join(dir, name), content);
    manifest.sha256[name] = createHash('sha256').update(content).digest('hex');
  }
  const manifestText = json(manifest);
  writeFileSync(join(dir, 'manifest.json'), manifestText);
  const manifestSha256 = createHash('sha256')
    .update(manifestText)
    .digest('hex');

  await appendChained(prisma, chainKey, {
    id: randomUUID(),
    createdAt: new Date(),
    actorPseudonym: 'system',
    actorRole: null,
    action: 'incident.snapshot',
    targetPseudonym: null,
    resourceType: 'evidence',
    resourceRef: manifestSha256.slice(0, 16),
    reason: `${logs.length} audit row(s), ${alerts.length} alert(s), chain ${verifier.result.ok ? 'ok' : 'BROKEN'}`,
    outcome: 'ALLOWED',
  });
  return { dir, manifestSha256 };
}

async function main() {
  const out = arg('out');
  if (!out)
    throw new Error(
      'Usage: incident-snapshot --out <dir> [--since <ISO date>]',
    );
  const sinceArg = arg('since');
  const since = sinceArg ? new Date(sinceArg) : undefined;
  if (since && Number.isNaN(since.getTime()))
    throw new Error('--since is not a date');

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
    const { dir, manifestSha256 } = await takeSnapshot(prisma, key, out, since);
    console.log(
      `snapshot written to ${dir}\nmanifest sha256: ${manifestSha256}`,
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
