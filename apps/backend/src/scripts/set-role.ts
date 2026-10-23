/**
 * Operator-only: give an account a role (ROADMAP.md O14). This is how the
 * very first ADMIN exists — after that, ADMINs manage roles through
 * PATCH /admin/users/:id/role. Requires direct database access (it runs on
 * the backend host with its env), which is itself the authorization: no
 * HTTP route can do what this does without an ADMIN session.
 *
 *   npm run user:set-role -- <email> <USER|SUPPORT|ADMIN>
 *
 * Audited like the HTTP path, with actor "system". Prints the masked email
 * only.
 */
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '../../generated/prisma';
import configuration from '../config/configuration';
import { ROLES, type Role } from '../common/auth/permissions';
import {
  AUDIT_SCOPE,
  PseudonymService,
} from '../common/privacy/pseudonym.service';
import { SYSTEM_ACTOR } from '../common/audit/audit.service';
import { maskEmail } from '../common/privacy/redact';

async function main() {
  const [email, role] = process.argv.slice(2);
  if (!email || !ROLES.includes(role as Role)) {
    throw new Error(`usage: set-role <email> <${ROLES.join('|')}>`);
  }
  const { database, privacy } = configuration();
  if (!database.url) throw new Error('DATABASE_URL is not set');
  if (!privacy.pseudonymKey) throw new Error('PSEUDONYM_KEY is not set');
  const pseudonyms = new PseudonymService(privacy.pseudonymKey);
  const prisma = new PrismaClient({
    adapter: new PrismaPg({ connectionString: database.url }),
  });

  try {
    const user = await prisma.user.findUnique({ where: { email } });
    if (!user) throw new Error(`No account for ${maskEmail(email)}`);
    await prisma.user.update({
      where: { id: user.id },
      data: { role: role as Role },
    });
    await prisma.auditLog.create({
      data: {
        actorPseudonym: SYSTEM_ACTOR,
        actorRole: 'ADMIN',
        action: 'system.role.set',
        targetPseudonym: pseudonyms.pseudonymize(user.id, AUDIT_SCOPE),
        reason: `${user.role} -> ${role}`,
        outcome: 'ALLOWED',
      },
    });
    console.log(`${maskEmail(email)}: ${user.role} -> ${role}`);
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
