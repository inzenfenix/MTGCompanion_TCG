/**
 * Global containment (ROADMAP.md O15, ACTIVIDAD_5.md §4.3–4.4): ends EVERY
 * session of EVERY account — for a leaked JWT_SECRET, a stolen database
 * dump containing refresh-token hashes, or any incident where you can't
 * tell which sessions are compromised.
 *
 *   npm run incident:revoke-all-sessions -- --confirm
 *
 * Deletes every refresh token and stamps users.sessionsRevokedAt = now, so
 * JwtStrategy rejects every access token issued before this instant even
 * if its signature is still valid. If the cause is a leaked JWT_SECRET, also
 * rotate it (Secrets Manager + redeploy) — this script alone doesn't stop
 * an attacker from minting *new* tokens with the old secret.
 * Doesn't delete or change any player data. Recorded in the audit chain.
 */
import { randomUUID } from 'node:crypto';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '../../generated/prisma';
import configuration from '../config/configuration';
import {
  AUDIT_CHAIN_KEY_LABEL,
  appendChained,
} from '../common/audit/audit-chain';
import { PseudonymService } from '../common/privacy/pseudonym.service';

export async function revokeAllSessions(
  prisma: PrismaClient,
  chainKey: Buffer,
) {
  const now = new Date();
  const [tokens, users] = await prisma.$transaction([
    prisma.refreshToken.deleteMany({}),
    prisma.user.updateMany({ data: { sessionsRevokedAt: now } }),
  ]);
  await appendChained(prisma, chainKey, {
    id: randomUUID(),
    createdAt: new Date(),
    actorPseudonym: 'system',
    actorRole: null,
    action: 'security.containment.revoke-all-sessions',
    targetPseudonym: null,
    resourceType: 'session',
    resourceRef: null,
    reason: `${users.count} account(s), ${tokens.count} refresh token(s)`,
    outcome: 'ALLOWED',
  });
  return { refreshTokens: tokens.count, accounts: users.count };
}

async function main() {
  if (!process.argv.includes('--confirm')) {
    throw new Error('This logs out every user. Re-run with --confirm.');
  }
  const { database, privacy } = configuration();
  if (!database.url) throw new Error('DATABASE_URL is not set');
  if (!privacy.pseudonymKey) throw new Error('PSEUDONYM_KEY is not set');
  const prisma = new PrismaClient({
    adapter: new PrismaPg({ connectionString: database.url }),
  });
  try {
    const key = new PseudonymService(privacy.pseudonymKey).deriveKey(
      AUDIT_CHAIN_KEY_LABEL,
    );
    const counts = await revokeAllSessions(prisma, key);
    console.log(
      `revoked: ${counts.refreshTokens} refresh token(s) deleted, ${counts.accounts} account(s) stamped.`,
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
