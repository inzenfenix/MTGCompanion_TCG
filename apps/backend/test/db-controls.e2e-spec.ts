import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { INestApplication } from '@nestjs/common';
import { App } from 'supertest/types';
import { Client } from 'pg';
import * as bcrypt from 'bcryptjs';
import { PrismaService } from './../src/prisma/prisma.service';
import { anonymizeDatabase, DEV_PASSWORD } from './../src/scripts/anonymize-db';
import {
  cleanupUsers,
  createApp,
  registerAndLogin,
  type TestAccount,
} from './helpers/o14-helpers';

// ROADMAP.md O14 / docs/security/ACTIVIDAD_4.md §5 — controls enforced by
// PostgreSQL itself, independent of the API code.
const onThrowawayDb = process.env.E2E_EMBEDDED_DB === '1';

describe('Database-level controls (e2e)', () => {
  let app: INestApplication<App>;
  let prisma: PrismaService;

  beforeAll(async () => {
    app = await createApp();
    prisma = app.get(PrismaService);
  });
  afterAll(async () => app.close());

  describe('audit_logs is append-only (trigger)', () => {
    let id: string;
    beforeAll(async () => {
      id = (
        await prisma.auditLog.create({
          data: {
            actorPseudonym: 'u_0000000000000000',
            actorRole: 'USER',
            action: 'e2e.append-only',
            outcome: 'ALLOWED',
          },
        })
      ).id;
    });

    it('INSERT works', async () => {
      expect(
        await prisma.auditLog.findUnique({ where: { id } }),
      ).not.toBeNull();
    });

    it.each([
      [
        'UPDATE',
        () =>
          prisma.$executeRaw`UPDATE "audit_logs" SET "outcome" = 'DENIED' WHERE "id" = ${id}`,
      ],
      [
        'DELETE',
        () => prisma.$executeRaw`DELETE FROM "audit_logs" WHERE "id" = ${id}`,
      ],
      ['TRUNCATE', () => prisma.$executeRaw`TRUNCATE "audit_logs"`],
    ])('%s is rejected by the database', async (_op, run) => {
      await expect(run()).rejects.toThrow(/append-only/);
      expect(await prisma.auditLog.findUnique({ where: { id } })).toMatchObject(
        { outcome: 'ALLOWED' },
      );
    });
  });

  (onThrowawayDb ? describe : describe.skip)(
    'least-privilege runtime role mtg_app',
    () => {
      let appDb: Client;
      beforeAll(async () => {
        const sql = readFileSync(
          join(__dirname, '..', 'prisma', 'sql', 'least-privilege-role.sql'),
          'utf8',
        );
        const owner = new Client({
          connectionString: process.env.DATABASE_URL,
        });
        await owner.connect();
        await owner.query(sql);
        await owner.query(`ALTER ROLE mtg_app PASSWORD 'e2e-only-password'`);
        await owner.end();
        const url = new URL(process.env.DATABASE_URL!);
        url.username = 'mtg_app';
        url.password = 'e2e-only-password';
        url.search = '';
        appDb = new Client({ connectionString: url.toString() });
        await appDb.connect();
      });
      afterAll(async () => appDb.end());

      it('can read and write ordinary rows', async () => {
        await expect(
          appDb.query('SELECT count(*) FROM "users"'),
        ).resolves.toBeDefined();
        await expect(
          appDb.query(
            `INSERT INTO "audit_logs" ("id","actorPseudonym","actorRole","action","outcome") VALUES (gen_random_uuid()::text,'u_1111111111111111','USER','e2e.mtg_app','ALLOWED')`,
          ),
        ).resolves.toBeDefined();
      });

      it.each([
        [
          'UPDATE the audit log',
          `UPDATE "audit_logs" SET "outcome" = 'DENIED'`,
        ],
        ['DELETE from the audit log', `DELETE FROM "audit_logs"`],
        ['DROP a table', `DROP TABLE "users"`],
        ['ALTER a table', `ALTER TABLE "users" ADD COLUMN "birthDate" date`],
        ['CREATE a table', `CREATE TABLE "exfil" (x text)`],
        ['read migration history', `SELECT * FROM "_prisma_migrations"`],
        ['write the catalog', `DELETE FROM "catalog_cards"`],
        // O15 (ACTIVIDAD_5.md §5)
        [
          'rewrite consent history',
          `UPDATE "consent_events" SET "action" = 'GRANTED'`,
        ],
        ['delete rights requests', `DELETE FROM "data_rights_requests"`],
        ['delete security alerts', `DELETE FROM "security_alerts"`],
      ])('cannot %s', async (_what, sql) => {
        await expect(appDb.query(sql)).rejects.toThrow(
          /permission denied|must be owner/,
        );
      });
    },
  );

  (onThrowawayDb ? describe : describe.skip)(
    'anonymizer for dev copies',
    () => {
      let a: TestAccount;
      let b: TestAccount;

      beforeAll(async () => {
        a = await registerAndLogin(
          app,
          `an-a-${Date.now()}@example.com`,
          'Ana Real',
        );
        b = await registerAndLogin(
          app,
          `an-b-${Date.now()}@example.com`,
          'Beto Real',
        );
        await prisma.userSettings.update({
          where: { userId: a.id },
          data: {
            twoFactorSecret: 'v1:x:y:z',
            twoFactorEnabled: true,
            lastLat: 'v1:a:b:c',
            shareLocation: true,
          },
        });
      });
      afterAll(async () => cleanupUsers(prisma, [a.id, b.id]));

      it('replaces identities, wipes secrets/location/sessions, empties the audit log', async () => {
        const before = await prisma.user.findMany({
          select: { email: true, displayName: true },
        });
        await anonymizeDatabase(prisma);
        const after = await prisma.user.findMany({
          include: { settings: true },
        });

        for (const u of after) {
          expect(u.email).toMatch(/^user-\d+@example\.invalid$/);
          expect(u.displayName).toMatch(/^Jugador \d+$/);
          expect(u.settings).toMatchObject({
            twoFactorSecret: null,
            twoFactorEnabled: false,
            lastLat: null,
            shareLocation: false,
          });
        }
        const afterJson = JSON.stringify(after);
        for (const orig of before) {
          expect(afterJson).not.toContain(orig.email);
          expect(afterJson).not.toContain(orig.displayName);
        }
        expect(await prisma.refreshToken.count()).toBe(0);
        expect(await prisma.auditLog.count()).toBe(0);
      });

      it('leaves the append-only trigger re-enabled afterwards', async () => {
        const row = await prisma.auditLog.create({
          data: {
            actorPseudonym: 'u_2222222222222222',
            actorRole: 'USER',
            action: 'e2e.after-anon',
            outcome: 'ALLOWED',
          },
        });
        await expect(
          prisma.$executeRaw`DELETE FROM "audit_logs" WHERE "id" = ${row.id}`,
        ).rejects.toThrow(/append-only/);
      });

      it('every account logs in with the known dev password', async () => {
        const anyUser = await prisma.user.findUniqueOrThrow({
          where: { id: a.id },
        });
        expect(await bcrypt.compare(DEV_PASSWORD, anyUser.passwordHash)).toBe(
          true,
        );
      });
    },
  );
});
