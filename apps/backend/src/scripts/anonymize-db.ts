/**
 * Anonymizes a COPY of the database for development, testing or demos
 * (ROADMAP.md O14, docs/security/ACTIVIDAD_4.md §2). Never point this at
 * the real database: it irreversibly overwrites every account.
 *
 *   NODE_ENV=development DATABASE_URL=<the copy> npm run db:anonymize -- --confirm-dev-copy
 *
 * Refuses to run with NODE_ENV=production or without --confirm-dev-copy.
 *
 * What it does, and why that is anonymization rather than pseudonymization:
 * the original values are *replaced*, not encoded — there is no key or
 * lookup table anywhere that maps "Jugador 17" back to a person.
 *   - users: email → user-<n>@example.invalid, displayName → "Jugador <n>",
 *     n assigned in random order (so it doesn't leak registration order);
 *     every password → the same known dev password (so devs can log in);
 *     createdAt/adultConfirmedAt/emailVerifiedAt truncated to the day.
 *   - user_settings: 2FA secret, location and its timestamp erased.
 *   - refresh_tokens, card_photos: deleted. audit_logs: emptied (its
 *     append-only trigger is disabled for that one statement — possible
 *     only as the table owner, which the app's runtime role shouldn't be).
 *   - cards.description (free text) → null; transactions.paymentRef (a
 *     MercadoPago payment id, linkable to a real card holder) → null;
 *     transaction timestamps truncated to the day.
 * Kept: card data, amounts, conditions, auction bids, coupons — what a
 * developer actually needs to reproduce marketplace behaviour.
 *
 * Residual risk (stated in ACTIVIDAD_4.md §6): row ids (UUIDs) survive, so
 * someone who *also* has the real database could re-link rows by id. For
 * anyone who only gets the copy, nothing in it identifies a person.
 */
import * as bcrypt from 'bcryptjs';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '../../generated/prisma';

export const DEV_PASSWORD = 'dev-password-123';

export async function anonymizeDatabase(prisma: PrismaClient) {
  const passwordHash = await bcrypt.hash(DEV_PASSWORD, 12);
  return prisma.$transaction(async (tx) => {
    const users = await tx.$executeRaw`
      UPDATE "users" u
         SET "email"            = 'user-' || s.n || '@example.invalid',
             "displayName"      = 'Jugador ' || s.n,
             "passwordHash"     = ${passwordHash},
             "createdAt"        = date_trunc('day', u."createdAt"),
             "adultConfirmedAt" = date_trunc('day', u."adultConfirmedAt"),
             "emailVerifiedAt"  = date_trunc('day', u."emailVerifiedAt")
        FROM (SELECT "id", row_number() OVER (ORDER BY random()) AS n FROM "users") s
       WHERE u."id" = s."id"`;
    await tx.$executeRaw`
      UPDATE "user_settings"
         SET "twoFactorSecret" = NULL, "twoFactorEnabled" = false,
             "lastLat" = NULL, "lastLng" = NULL,
             "shareLocation" = false, "locationUpdatedAt" = NULL`;
    const tokens = await tx.$executeRaw`DELETE FROM "refresh_tokens"`;
    const photos = await tx.$executeRaw`DELETE FROM "card_photos"`;
    await tx.$executeRaw`UPDATE "cards" SET "description" = NULL`;
    await tx.$executeRaw`
      UPDATE "transactions"
         SET "paymentRef" = NULL,
             "createdAt"  = date_trunc('day', "createdAt"),
             "updatedAt"  = date_trunc('day', "updatedAt")`;
    await tx.$executeRaw`ALTER TABLE "audit_logs" DISABLE TRIGGER "audit_logs_no_truncate"`;
    await tx.$executeRaw`TRUNCATE "audit_logs"`;
    await tx.$executeRaw`ALTER TABLE "audit_logs" ENABLE TRIGGER "audit_logs_no_truncate"`;
    return { users, refreshTokens: tokens, cardPhotos: photos };
  });
}

async function main() {
  if (process.env.NODE_ENV === 'production') {
    throw new Error(
      'Refusing to anonymize with NODE_ENV=production — run this against a copy.',
    );
  }
  if (!process.argv.includes('--confirm-dev-copy')) {
    throw new Error(
      'This overwrites every account. Re-run with --confirm-dev-copy if DATABASE_URL is a copy.',
    );
  }
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error('DATABASE_URL is not set');
  const prisma = new PrismaClient({
    adapter: new PrismaPg({ connectionString: url }),
  });
  try {
    const counts = await anonymizeDatabase(prisma);
    console.log(
      `anonymized ${counts.users} account(s); deleted ${counts.refreshTokens} refresh token(s) and ` +
        `${counts.cardPhotos} photo row(s); audit log emptied. Dev password for every account: ${DEV_PASSWORD}`,
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
