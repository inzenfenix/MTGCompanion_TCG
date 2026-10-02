/**
 * One-off / idempotent: encrypts the user_settings values that are still
 * plaintext (rows written before ROADMAP.md O2/O3 shipped) and re-encrypts
 * values under a retired key with the current one (key rotation).
 *
 *   npm run db:encrypt-fields
 *
 * Safe to re-run: a value already encrypted with the current key is left
 * untouched. docker-entrypoint.sh runs it (compiled, dist/scripts/) right
 * after `prisma migrate deploy` on every container start.
 * Prints counts only — never a plaintext value or a key.
 */
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '../../generated/prisma';
import configuration from '../config/configuration';
import { FieldEncryptionService } from '../common/crypto/field-encryption.service';

const FIELDS = ['twoFactorSecret', 'lastLat', 'lastLng'] as const;

async function main() {
  const { database, fieldEncryption } = configuration();
  if (!database.url) throw new Error('DATABASE_URL is not set');
  if (Object.keys(fieldEncryption.keys).length === 0) {
    throw new Error('FIELD_ENCRYPTION_KEY is not set');
  }
  const crypto = new FieldEncryptionService(fieldEncryption);
  const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: database.url }) });

  try {
    const rows = await prisma.userSettings.findMany({
      select: { id: true, twoFactorSecret: true, lastLat: true, lastLng: true },
    });
    const counts = { plaintext: 0, rotated: 0, unchanged: 0 };
    for (const row of rows) {
      const data: Partial<Record<(typeof FIELDS)[number], string>> = {};
      for (const field of FIELDS) {
        const value = row[field];
        if (value == null || !crypto.needsReencryption(value)) {
          if (value != null) counts.unchanged++;
          continue;
        }
        if (crypto.isEncrypted(value)) {
          data[field] = crypto.encrypt(crypto.decrypt(value));
          counts.rotated++;
        } else {
          data[field] = crypto.encrypt(value);
          counts.plaintext++;
        }
      }
      if (Object.keys(data).length > 0) {
        await prisma.userSettings.update({ where: { id: row.id }, data });
      }
    }
    console.log(
      `user_settings: ${rows.length} rows scanned — encrypted ${counts.plaintext} plaintext value(s), ` +
        `re-encrypted ${counts.rotated} under a retired key, ${counts.unchanged} already current.`,
    );
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
