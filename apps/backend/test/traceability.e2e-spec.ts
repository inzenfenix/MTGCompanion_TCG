import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { App } from 'supertest/types';
import { isCatalogued } from './../src/common/audit/audit-events';
import { PseudonymService } from './../src/common/privacy/pseudonym.service';
import { PrismaService } from './../src/prisma/prisma.service';
import {
  cleanupUsers,
  createApp,
  FakeEmailProvider,
  grantConsent,
  registerAndLogin,
  stepUp,
  withFakeEmail,
  type TestAccount,
} from './helpers/o14-helpers';

interface Timeline {
  trustworthy: boolean;
  subject: string;
  summary: {
    events: number;
    byPhase: Record<string, number>;
    dataCategories: string[];
    affectedSubjects: { pseudonym: string }[];
    uncatalogued: string[];
  };
  events: { action: string; phase: string; outcome: string }[];
}

// ROADMAP.md O17 / docs/security/ACTIVIDAD_7.md — access logging, the
// system-specific alerts and incident reconstruction, end to end.
describe('Traceability (e2e)', () => {
  let app: INestApplication<App>;
  let prisma: PrismaService;
  let pseudonym: (id: string) => string;
  const mail = new FakeEmailProvider();
  const stamp = Date.now();
  const http = () => request(app.getHttpServer());
  const auth = (t: string) => ({ Authorization: `Bearer ${t}` });
  const ids: string[] = [];
  const account = async (tag: string, name: string) => {
    const a = await registerAndLogin(
      app,
      `o17-${tag}-${stamp}@example.com`,
      name,
    );
    ids.push(a.id);
    return a;
  };
  const relogin = async (a: TestAccount) => {
    const r = await http()
      .post('/auth/login')
      .send({ email: a.email, password: 'o14-test-pass-123' })
      .expect(201);
    a.token = (r.body as { accessToken: string }).accessToken;
  };
  const rows = (where: object) =>
    prisma.auditLog.findMany({ where, orderBy: { seq: 'asc' } });
  const alertsFor = (rule: string, id: string) =>
    prisma.securityAlert.findMany({
      where: { rule, subjectPseudonym: pseudonym(id) },
    });

  let sel: TestAccount; // seller
  let buy: TestAccount; // buyer
  let eve: TestAccount; // curious / attacker
  let adm: TestAccount; // admin
  let txId: string;
  const title = `O17 Card ${stamp}`;

  beforeAll(async () => {
    app = await createApp(withFakeEmail(mail));
    prisma = app.get(PrismaService);
    const ps = app.get(PseudonymService);
    pseudonym = (id) => ps.pseudonymize(id);
    sel = await account('sel', 'O17 Seller');
    buy = await account('buy', 'O17 Buyer');
    eve = await account('eve', 'O17 Eve');
    adm = await account('adm', 'O17 Admin');
    await prisma.user.update({
      where: { id: adm.id },
      data: { role: 'ADMIN' },
    });

    const card = await http()
      .post('/cards')
      .set(auth(sel.token))
      .send({ title, guessedPrice: 12 })
      .expect(201);
    const tx = await prisma.transaction.create({
      data: {
        cardId: (card.body as { id: string }).id,
        buyerId: buy.id,
        sellerId: sel.id,
        amount: 12,
        status: 'PAID',
        paymentMethod: 'CASH',
      },
    });
    txId = tx.id;
  });
  afterAll(async () => {
    await prisma.securityAlert.deleteMany({
      where: { subjectPseudonym: { in: ids.map((i) => pseudonym(i)) } },
    });
    await prisma.dataRightsRequest.deleteMany({
      where: { userId: { in: ids } },
    });
    await cleanupUsers(prisma, ids);
    await app.close();
  });

  // ── §2 access logging ────────────────────────────────────────────────

  describe('access to personal data is logged — who, what, whose, never the data', () => {
    it('registration and card creation leave a row', async () => {
      expect(
        await rows({
          action: 'account.register',
          actorPseudonym: pseudonym(sel.id),
        }),
      ).toHaveLength(1);
      expect(
        await rows({
          action: 'market.card.create',
          actorPseudonym: pseudonym(sel.id),
        }),
      ).toHaveLength(1);
    });

    it('a party reading a transaction: ALLOWED, counterparty as target', async () => {
      await http()
        .get(`/transactions/${txId}`)
        .set(auth(buy.token))
        .expect(200);
      const [r] = await rows({
        action: 'access.transaction.read',
        actorPseudonym: pseudonym(buy.id),
      });
      expect(r).toMatchObject({
        outcome: 'ALLOWED',
        resourceType: 'transaction',
        resourceRef: txId,
        targetPseudonym: pseudonym(sel.id),
      });
    });

    it('the receipt and the list are logged too', async () => {
      await http()
        .get(`/transactions/${txId}/receipt`)
        .set(auth(sel.token))
        .expect(200);
      await http().get('/transactions').set(auth(sel.token)).expect(200);
      const [rc] = await rows({
        action: 'access.receipt.read',
        actorPseudonym: pseudonym(sel.id),
      });
      expect(rc).toMatchObject({
        outcome: 'ALLOWED',
        targetPseudonym: pseudonym(buy.id),
      });
      const [ls] = await rows({
        action: 'access.transaction.list',
        actorPseudonym: pseudonym(sel.id),
      });
      expect(ls.reason).toBe('n=1');
    });

    it('a stranger trying to read it: DENIED (forbidden), no target leaked', async () => {
      await http()
        .get(`/transactions/${txId}`)
        .set(auth(eve.token))
        .expect(403);
      const [r] = await rows({
        action: 'access.transaction.read',
        actorPseudonym: pseudonym(eve.id),
      });
      expect(r).toMatchObject({
        outcome: 'DENIED',
        reason: 'forbidden',
        targetPseudonym: null,
      });
    });

    it('profile reads, location writes and the admin user list are logged', async () => {
      await http().get(`/users/${sel.id}`).set(auth(buy.token)).expect(200);
      await grantConsent(app, sel.token, 'LOCATION_DISTANCE');
      await http()
        .patch('/users/me/location')
        .set(auth(sel.token))
        .send({ lat: -33.4489, lng: -70.6693 })
        .expect(200);
      await http().get('/admin/users').set(auth(adm.token)).expect(200);
      expect(
        await rows({
          action: 'access.profile.read',
          targetPseudonym: pseudonym(sel.id),
        }),
      ).toHaveLength(1);
      expect(
        await rows({
          action: 'account.location.update',
          actorPseudonym: pseudonym(sel.id),
        }),
      ).toHaveLength(1);
      const [ul] = await rows({
        action: 'admin.users.list',
        actorPseudonym: pseudonym(adm.id),
      });
      expect(ul.reason).toMatch(/^n=\d+$/);
    });

    it('Bazaar distances: only for a logged-in searcher, logged as a count', async () => {
      const anon = await http()
        .get('/cards')
        .query({ q: title, lat: -33.45, lng: -70.65 })
        .expect(200);
      expect(
        (anon.body as { distanceKm: number | null }[])[0].distanceKm,
      ).toBeNull();
      const logged = await http()
        .get('/cards')
        .query({ q: title, lat: -33.45, lng: -70.65 })
        .set(auth(buy.token))
        .expect(200);
      expect(
        (logged.body as { distanceKm: number | null }[])[0].distanceKm,
      ).toEqual(expect.any(Number));
      const [r] = await rows({
        action: 'access.location.distance',
        actorPseudonym: pseudonym(buy.id),
      });
      expect(r.reason).toBe('sellers=1;new-position');
    });

    it('none of these rows carries an email, a name, an id or a coordinate', async () => {
      const all = await rows({
        OR: [
          { actorPseudonym: { in: ids.map((i) => pseudonym(i)) } },
          { targetPseudonym: { in: ids.map((i) => pseudonym(i)) } },
        ],
      });
      const dump = JSON.stringify(all, (_k, v: unknown) =>
        typeof v === 'bigint' ? v.toString() : v,
      );
      for (const a of [sel, buy, eve, adm]) {
        expect(dump).not.toContain(a.id);
        expect(dump).not.toContain(a.email);
      }
      expect(dump).not.toContain('O17 Seller');
      expect(dump).not.toMatch(/-33\.4|-70\.6/);
      // every row is in the hash chain
      expect(all.every((r) => r.hash !== null)).toBe(true);
    });
  });

  // ── §4 system-specific alerts ────────────────────────────────────────

  describe('alerts', () => {
    it("transactions.enumeration: 5 reads of transactions that aren't yours", async () => {
      for (let i = 0; i < 4; i++) {
        await http()
          .get(`/transactions/${txId}/receipt`)
          .set(auth(eve.token))
          .expect(403);
      }
      const alerts = await alertsFor('transactions.enumeration', eve.id);
      expect(alerts).toHaveLength(1);
      expect(alerts[0]).toMatchObject({ severity: 'MEDIUM', status: 'OPEN' });
    });

    it('bazaar.location.triangulation: searches from 5 different cells → alert + sessions revoked', async () => {
      const points = [
        [-33.4, -70.6],
        [-33.5, -70.6],
        [-33.45, -70.7],
        [-33.38, -70.52],
      ];
      for (const [lat, lng] of points) {
        await http()
          .get('/cards')
          .query({ q: title, lat, lng })
          .set(auth(buy.token))
          .expect(200);
      }
      const alerts = await alertsFor('bazaar.location.triangulation', buy.id);
      expect(alerts).toHaveLength(1);
      expect(alerts[0].severity).toBe('HIGH');
      await http().get('/transactions').set(auth(buy.token)).expect(401);
      await relogin(buy);
    });

    it('a seller searching from the same place many times is NOT an alert', async () => {
      for (let i = 0; i < 6; i++) {
        await http()
          .get('/cards')
          .query({ q: title, lat: -33.4489 + i * 0.0001, lng: -70.6693 })
          .set(auth(sel.token))
          .expect(200);
      }
      expect(
        await alertsFor('bazaar.location.triangulation', sel.id),
      ).toHaveLength(0);
    });

    it('account.takeover.sequence: email change then full export within 1 h', async () => {
      const t1 = await stepUp(app, eve.token);
      const newEmail = `o17-eve2-${stamp}@example.com`;
      await http()
        .post('/data-rights/requests')
        .set(auth(eve.token))
        .send({
          type: 'RECTIFICATION',
          rectification: { email: newEmail },
          stepUpToken: t1,
        })
        .expect(201);
      eve.email = newEmail;
      await relogin(eve); // the email change revoked every session
      const t2 = await stepUp(app, eve.token);
      await http()
        .post('/data-rights/requests')
        .set(auth(eve.token))
        .send({ type: 'ACCESS', stepUpToken: t2 })
        .expect(201);
      const alerts = await alertsFor('account.takeover.sequence', eve.id);
      expect(alerts).toHaveLength(1);
      expect(alerts[0].severity).toBe('HIGH');
      await http().get('/transactions').set(auth(eve.token)).expect(401);
      await relogin(eve);
    });

    it('a plain export with no email change is not a takeover', async () => {
      const t = await stepUp(app, sel.token);
      await http()
        .post('/data-rights/requests')
        .set(auth(sel.token))
        .send({ type: 'ACCESS', stepUpToken: t })
        .expect(201);
      expect(await alertsFor('account.takeover.sequence', sel.id)).toHaveLength(
        0,
      );
    });

    it('admin.reidentification.burst: an ADMIN resolving 5 pseudonyms in an hour', async () => {
      for (const a of [sel, buy, eve, sel, buy]) {
        await http()
          .post('/admin/pseudonyms/resolve')
          .set(auth(adm.token))
          .send({
            pseudonym: pseudonym(a.id),
            reason: 'Revisión de soporte del caso INC-7',
          })
          .expect(201);
      }
      const alerts = await alertsFor('admin.reidentification.burst', adm.id);
      expect(alerts).toHaveLength(1);
      // staff abuse goes to a human: the admin keeps a working session
      await http().get('/admin/users').set(auth(adm.token)).expect(200);
    });
  });

  // ── §6 reconstruction ────────────────────────────────────────────────

  describe('incident reconstruction', () => {
    let alertId: string;
    beforeAll(async () => {
      alertId = (await alertsFor('account.takeover.sequence', eve.id))[0].id;
    });

    it('rebuilds the takeover from the log, phase by phase', async () => {
      const res = await http()
        .get(`/admin/security/incidents/${alertId}/timeline`)
        .set(auth(adm.token))
        .expect(200);
      const t = res.body as Timeline;
      expect(t.trustworthy).toBe(true);
      expect(t.subject).toBe(pseudonym(eve.id));
      for (const phase of [
        'ACCESO',
        'RECONOCIMIENTO',
        'MODIFICACION',
        'EXFILTRACION_O_DESTRUCCION',
        'DETECCION',
        'CONTENCION',
      ]) {
        expect(t.summary.byPhase[phase]).toBeGreaterThan(0);
      }
      const actions = t.events.map((e) => e.action);
      const order = (a: string) => actions.indexOf(a);
      expect(order('data.rectify')).toBeLessThan(order('data.export'));
      const raised = t.events.findIndex(
        (e) =>
          e.action === 'security.alert.raised' &&
          (e as { resourceRef?: string }).resourceRef === alertId,
      );
      expect(order('data.export')).toBeLessThan(raised);
      expect(t.summary.uncatalogued).toEqual([]);
      expect(t.summary.dataCategories).toEqual(
        expect.arrayContaining(['identificación', 'transacciones']),
      );
    });

    it('is available as a markdown report, and reading it is audited', async () => {
      const res = await http()
        .get(`/admin/security/incidents/${alertId}/timeline`)
        .query({ format: 'md' })
        .set(auth(adm.token))
        .expect(200);
      expect(res.text).toMatch(/Reconstrucción del incidente/);
      expect(res.text).toMatch(/Cadena de integridad: OK/);
      expect(
        await rows({ action: 'admin.incident.timeline', resourceRef: alertId }),
      ).toHaveLength(2);
    });

    it('USER and SUPPORT cannot reconstruct incidents (403, audited)', async () => {
      await http()
        .get(`/admin/security/incidents/${alertId}/timeline`)
        .set(auth(sel.token))
        .expect(403);
      await prisma.user.update({
        where: { id: sel.id },
        data: { role: 'SUPPORT' },
      });
      await http()
        .get(`/admin/security/incidents/${alertId}/timeline`)
        .set(auth(sel.token))
        .expect(403);
      await prisma.user.update({
        where: { id: sel.id },
        data: { role: 'USER' },
      });
    });
  });

  it('every action written during this suite is in the catalog', async () => {
    const actions = await prisma.auditLog.findMany({
      distinct: ['action'],
      select: { action: true },
    });
    const missing = actions
      .map((a) => a.action)
      .filter((a) => !isCatalogued(a));
    expect(missing).toEqual([]);
  });
});
