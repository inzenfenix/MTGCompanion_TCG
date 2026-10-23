import { mkdtempSync, readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { App } from 'supertest/types';
import { PrismaService } from './../src/prisma/prisma.service';
import { PseudonymService } from './../src/common/privacy/pseudonym.service';
import { AUDIT_CHAIN_KEY_LABEL } from './../src/common/audit/audit-chain';
import { purgeExpiredData } from './../src/scripts/purge-expired-data';
import { takeSnapshot } from './../src/scripts/incident-snapshot';
import {
  cleanupUsers,
  createApp,
  FakeEmailProvider,
  registerAndLogin,
  TEST_PASSWORD,
  withFakeEmail,
  type TestAccount,
} from './helpers/o14-helpers';

interface Alert {
  id: string;
  rule: string;
  severity: string;
  status: string;
  subjectPseudonym: string | null;
}

const bigintSafe = (v: unknown) =>
  JSON.stringify(v, (_k, x: unknown) =>
    typeof x === 'bigint' ? x.toString() : x,
  );

// ROADMAP.md O15 / docs/security/ACTIVIDAD_5.md §3–5 — detection rules,
// automatic and manual containment, the audit log's tamper evidence and
// retention, and the evidence-preserving snapshot.
describe('Security: detection, containment, audit integrity (e2e)', () => {
  let app: INestApplication<App>;
  let prisma: PrismaService;
  let pseudonyms: PseudonymService;
  const mail = new FakeEmailProvider();
  const stamp = Date.now();
  const ids: string[] = [];
  let admin: TestAccount;
  let support: TestAccount;
  const http = () => request(app.getHttpServer());
  const auth = (t: string) => ({ Authorization: `Bearer ${t}` });
  const account = async (tag: string) => {
    const a = await registerAndLogin(
      app,
      `sec-${tag}-${stamp}@example.com`,
      `Sec ${tag}`,
    );
    ids.push(a.id);
    return a;
  };
  const alertsFor = async (rule: string, userId?: string) =>
    (
      (
        await http()
          .get('/admin/security/alerts')
          .set(auth(admin.token))
          .expect(200)
      ).body as Alert[]
    ).filter(
      (a) =>
        a.rule === rule &&
        (!userId || a.subjectPseudonym === pseudonyms.pseudonymize(userId)),
    );

  beforeAll(async () => {
    app = await createApp(withFakeEmail(mail));
    prisma = app.get(PrismaService);
    pseudonyms = app.get(PseudonymService);
    admin = await account('admin');
    support = await account('support');
    await prisma.user.update({
      where: { id: admin.id },
      data: { role: 'ADMIN' },
    });
    await prisma.user.update({
      where: { id: support.id },
      data: { role: 'SUPPORT' },
    });
  });
  afterAll(async () => {
    await cleanupUsers(prisma, ids);
    await app.close();
  });

  describe('brute force → alert + automatic temporary lock', () => {
    let victim: TestAccount;
    beforeAll(async () => {
      victim = await account('victim');
      for (let i = 0; i < 5; i++) {
        await http()
          .post('/auth/login')
          .send({ email: victim.email, password: `wrong-${i}-password` })
          .expect(401);
      }
    });

    it('raises a HIGH auth.bruteforce alert for that account (pseudonym only)', async () => {
      const [alert] = await alertsFor('auth.bruteforce', victim.id);
      expect(alert).toMatchObject({ severity: 'HIGH', status: 'OPEN' });
      expect(bigintSafe(alert)).not.toContain(victim.email);
    });

    it('locks the account: even the right password gets the same generic 401', async () => {
      const res = await http()
        .post('/auth/login')
        .send({ email: victim.email, password: TEST_PASSWORD })
        .expect(401);
      expect((res.body as { message: string }).message).toBe(
        'Invalid email or password',
      );
    });

    it('the failed attempts are audited without the email typed in', async () => {
      const rows = await prisma.auditLog.findMany({
        where: {
          action: 'auth.login',
          actorPseudonym: pseudonyms.pseudonymize(victim.id),
        },
      });
      expect(rows.filter((r) => r.outcome === 'FAILED')).toHaveLength(5);
      expect(bigintSafe(rows)).not.toContain(victim.email);
      expect(
        await prisma.auditLog.count({
          where: {
            action: 'security.containment.lock',
            targetPseudonym: pseudonyms.pseudonymize(victim.id),
          },
        }),
      ).toBe(1);
    });

    it('a failed login for an unknown email is "anonymous" and keeps no trace of the email', async () => {
      const ghost = `ghost-${stamp}@example.com`;
      await http()
        .post('/auth/login')
        .send({ email: ghost, password: 'whatever-123' })
        .expect(401);
      const row = await prisma.auditLog.findFirst({
        where: { action: 'auth.login', actorPseudonym: 'anonymous' },
        orderBy: { seq: 'desc' },
      });
      expect(row).toMatchObject({ reason: 'unknown-email', actorRole: null });
      expect(bigintSafe(await prisma.auditLog.findMany())).not.toContain(ghost);
    });

    it('recovery: an ADMIN re-enables (lifting the lock), with a reason', async () => {
      await http()
        .post(`/admin/security/users/${victim.id}/enable`)
        .set(auth(admin.token))
        .send({ reason: 'Ticket 7: el titular confirmó por soporte' })
        .expect(201);
      await http()
        .post('/auth/login')
        .send({ email: victim.email, password: TEST_PASSWORD })
        .expect(201);
    });
  });

  it('repeated step-up failures on a live session → alert + every session revoked', async () => {
    const stolen = await account('stolen');
    for (let i = 0; i < 3; i++) {
      await http()
        .post('/auth/step-up')
        .set(auth(stolen.token))
        .send({ password: `guess-${i}-xxxx` })
        .expect(401);
    }
    expect(await alertsFor('auth.step-up.failures', stolen.id)).toHaveLength(1);
    await new Promise((r) => setTimeout(r, 1100)); // iat is in whole seconds
    await http().get('/consents/me').set(auth(stolen.token)).expect(401);
  });

  it('probing admin routes → access.denied.burst alert', async () => {
    const prober = await account('prober');
    for (let i = 0; i < 5; i++) {
      await http().get('/admin/audit-logs').set(auth(prober.token)).expect(403);
    }
    expect(await alertsFor('access.denied.burst', prober.id)).toHaveLength(1);
  });

  describe('manual containment (incident plan, ADMIN only)', () => {
    let target: TestAccount;
    beforeAll(async () => {
      target = await account('target');
    });

    it('SUPPORT and USER cannot use it', async () => {
      for (const t of [support.token, target.token]) {
        await http()
          .post(`/admin/security/users/${target.id}/disable`)
          .set(auth(t))
          .send({ reason: 'intento sin permiso de contencion' })
          .expect(403);
        await http().get('/admin/security/alerts').set(auth(t)).expect(403);
      }
    });

    it('a reason is mandatory, and an ADMIN cannot contain their own account', async () => {
      await http()
        .post(`/admin/security/users/${target.id}/revoke-sessions`)
        .set(auth(admin.token))
        .send({})
        .expect(400);
      await http()
        .post(`/admin/security/users/${admin.id}/disable`)
        .set(auth(admin.token))
        .send({ reason: 'probando auto-contencion' })
        .expect(400);
    });

    it('revoke-sessions kills an access token that is still within its 15 minutes', async () => {
      await http().get('/consents/me').set(auth(target.token)).expect(200);
      await new Promise((r) => setTimeout(r, 1100));
      await http()
        .post(`/admin/security/users/${target.id}/revoke-sessions`)
        .set(auth(admin.token))
        .send({ reason: 'Alerta 12: token filtrado en un log' })
        .expect(201);
      await http().get('/consents/me').set(auth(target.token)).expect(401);
    });

    it('disable blocks login; enable restores it', async () => {
      await http()
        .post(`/admin/security/users/${target.id}/disable`)
        .set(auth(admin.token))
        .send({ reason: 'Incidente 3: cuenta comprometida' })
        .expect(201);
      await http()
        .post('/auth/login')
        .send({ email: target.email, password: TEST_PASSWORD })
        .expect(401);
      await http()
        .post(`/admin/security/users/${target.id}/enable`)
        .set(auth(admin.token))
        .send({ reason: 'Incidente 3: contraseña cambiada, cerrado' })
        .expect(201);
      await http()
        .post('/auth/login')
        .send({ email: target.email, password: TEST_PASSWORD })
        .expect(201);
    });
  });

  it('alert triage follows alerta → evento sospechoso → incidente → cierre', async () => {
    const [alert] = await alertsFor('access.denied.burst');
    const move = (status: string) =>
      http()
        .patch(`/admin/security/alerts/${alert.id}`)
        .set(auth(admin.token))
        .send({ status, reason: `revisado: pasa a ${status}` });
    await move('CLOSED').expect(409); // can't skip the analysis
    expect(
      ((await move('INVESTIGATING').expect(200)).body as Alert).status,
    ).toBe('INVESTIGATING');
    expect(((await move('CONFIRMED').expect(200)).body as Alert).status).toBe(
      'CONFIRMED',
    );
    expect(
      ((await move('CLOSED').expect(200)).body as { handledBy: string })
        .handledBy,
    ).toBe(pseudonyms.pseudonymize(admin.id));
  });

  describe('audit log integrity', () => {
    it('the hash chain verifies', async () => {
      const res = await http()
        .get('/admin/security/audit/verify')
        .set(auth(admin.token))
        .expect(200);
      expect(res.body).toMatchObject({ ok: true });
      expect((res.body as { checked: number }).checked).toBeGreaterThan(10);
    });

    it('editing a row behind the trigger’s back is detected and raises an alert', async () => {
      const victim = await prisma.auditLog.findFirstOrThrow({
        where: { hash: { not: null }, action: 'auth.login' },
        orderBy: { seq: 'asc' },
      });
      const tamper = async (reason: string | null) => {
        // Only the table owner can do this — exactly the attacker the chain is for.
        await prisma.$executeRaw`ALTER TABLE "audit_logs" DISABLE TRIGGER "audit_logs_no_update_delete"`;
        await prisma.$executeRaw`UPDATE "audit_logs" SET "reason" = ${reason} WHERE "id" = ${victim.id}`;
        await prisma.$executeRaw`ALTER TABLE "audit_logs" ENABLE TRIGGER "audit_logs_no_update_delete"`;
      };
      await tamper('bad-password (edited)');
      try {
        const res = await http()
          .get('/admin/security/audit/verify')
          .set(auth(admin.token))
          .expect(200);
        expect(res.body).toMatchObject({
          ok: false,
          brokenAt: { seq: victim.seq.toString(), problem: 'hash-mismatch' },
        });
        expect(await alertsFor('audit.chain.broken')).toHaveLength(1);
      } finally {
        await tamper(victim.reason); // restore, so later suites see a clean chain
      }
    });

    it('UPDATE, DELETE and TRUNCATE are still refused for everyone', async () => {
      await expect(
        prisma.$executeRaw`UPDATE "audit_logs" SET "outcome" = 'X'`,
      ).rejects.toThrow(/append-only/);
      await expect(
        prisma.$executeRaw`DELETE FROM "audit_logs"`,
      ).rejects.toThrow(/append-only/);
    });

    it('retention: only rows past the period, only through the purge job', async () => {
      const old = await prisma.auditLog.create({
        data: {
          actorPseudonym: 'u_0000000000000000',
          actorRole: 'USER',
          action: 'e2e.retention.old',
          outcome: 'ALLOWED',
          createdAt: new Date(Date.now() - 800 * 24 * 3600 * 1000),
        },
      });
      const recent = await prisma.auditLog.create({
        data: {
          actorPseudonym: 'u_0000000000000000',
          actorRole: 'USER',
          action: 'e2e.retention.recent',
          outcome: 'ALLOWED',
          createdAt: new Date(Date.now() - 400 * 24 * 3600 * 1000),
        },
      });
      // Directly, even an old row can't be deleted (no session flag).
      await expect(
        prisma.$executeRaw`DELETE FROM "audit_logs" WHERE "id" = ${old.id}`,
      ).rejects.toThrow(/append-only/);
      // With the default 730 days, the 800-day row goes and the 400-day one stays.
      const key = pseudonyms.deriveKey(AUDIT_CHAIN_KEY_LABEL);
      const counts = await purgeExpiredData(prisma, 30, new Date(), {
        auditRetentionDays: 730,
        auditChainKey: key,
      });
      expect(counts.auditLogs).toBeGreaterThanOrEqual(1);
      expect(
        await prisma.auditLog.findUnique({ where: { id: old.id } }),
      ).toBeNull();
      expect(
        await prisma.auditLog.findUnique({ where: { id: recent.id } }),
      ).not.toBeNull();
      expect(
        await prisma.auditLog.count({
          where: { action: 'audit.retention.purge' },
        }),
      ).toBeGreaterThanOrEqual(1);
      // Asking for less than a year is clamped to the 365-day floor (the
      // trigger enforces the same floor): the 400-day row goes, nothing newer.
      const clamped = await purgeExpiredData(prisma, 30, new Date(), {
        auditRetentionDays: 100,
      });
      expect(clamped.retentionDays).toBe(365);
      expect(
        await prisma.auditLog.findUnique({ where: { id: recent.id } }),
      ).toBeNull();
      // ...and the chain still verifies after the purge.
      const res = await http()
        .get('/admin/security/audit/verify')
        .set(auth(admin.token))
        .expect(200);
      expect((res.body as { ok: boolean }).ok).toBe(true);
    });

    it('the incident snapshot preserves evidence with a verifiable manifest', async () => {
      const out = mkdtempSync(join(tmpdir(), 'mtg-snapshot-'));
      const { dir, manifestSha256 } = await takeSnapshot(
        prisma,
        pseudonyms.deriveKey(AUDIT_CHAIN_KEY_LABEL),
        out,
      );
      const manifestText = readFileSync(join(dir, 'manifest.json'), 'utf8');
      expect(createHash('sha256').update(manifestText).digest('hex')).toBe(
        manifestSha256,
      );
      const manifest = JSON.parse(manifestText) as {
        sha256: Record<string, string>;
        chainOk: boolean;
      };
      expect(manifest.chainOk).toBe(true);
      for (const [file, sha] of Object.entries(manifest.sha256)) {
        const content = readFileSync(join(dir, file), 'utf8');
        expect(createHash('sha256').update(content).digest('hex')).toBe(sha);
      }
      expect(readFileSync(join(dir, 'audit_logs.json'), 'utf8')).not.toContain(
        admin.email,
      );
    });
  });

  it('every new alert pages the security mailbox when SECURITY_ALERT_EMAIL is set', () => {
    // Not set in e2e: alerts must still work without any mail configured.
    expect(
      mail.sent.filter((m) => m.subject.includes('Alerta de seguridad')),
    ).toHaveLength(0);
  });
});
