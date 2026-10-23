/**
 * Retention (ROADMAP.md O14, docs/security/ACTIVIDAD_4.md §1): deletes data
 * that has outlived its purpose instead of keeping it "just in case".
 *
 *   - refresh_tokens past expiresAt — single-use and already unusable, but
 *     each row still links a user id to a login time.
 *   - user_settings locations older than LOCATION_TTL_DAYS (default 30) —
 *     search already ignores them (PrismaCardRepository), this erases them.
 *
 *   npm run db:purge-expired
 *
 * Idempotent. docker-entrypoint.sh runs it (compiled, dist/scripts/) on
 * every container start, next to encrypt-existing-fields. Prints counts only.
 */
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '../../generated/prisma';
import configuration from '../config/configuration';

export async function purgeExpiredData(
  prisma: PrismaClient,
  locationTtlDays: number,
  now: Date = new Date(),
) {
  const tokens = await prisma.refreshToken.deleteMany({
    where: { expiresAt: { lt: now } },
  });
  const cutoff = new Date(
    now.getTime() - locationTtlDays * 24 * 60 * 60 * 1000,
  );
  const locations = await prisma.userSettings.updateMany({
    where: { locationUpdatedAt: { lt: cutoff } },
    data: {
      shareLocation: false,
      lastLat: null,
      lastLng: null,
      locationUpdatedAt: null,
    },
  });
  return { refreshTokens: tokens.count, locations: locations.count };
}

async function main() {
  const { database, privacy } = configuration();
  if (!database.url) throw new Error('DATABASE_URL is not set');
  const prisma = new PrismaClient({
    adapter: new PrismaPg({ connectionString: database.url }),
  });
  try {
    const counts = await purgeExpiredData(prisma, privacy.locationTtlDays);
    console.log(
      `retention: deleted ${counts.refreshTokens} expired refresh token(s), ` +
        `erased ${counts.locations} location(s) older than ${privacy.locationTtlDays} days.`,
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
