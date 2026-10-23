import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { App } from 'supertest/types';
import { generate } from 'otplib';
import { PrismaService } from './../src/prisma/prisma.service';
import {
  cleanupUsers,
  createApp,
  FakeEmailProvider,
  registerAndLogin,
  withFakeEmail,
  type TestAccount,
} from './helpers/o14-helpers';

interface PurposeView {
  code: string;
  version: string;
  textHash: string;
  selfService: boolean;
}
interface ConsentView {
  purpose: string;
  status: 'GRANTED' | 'REVOKED' | 'NONE';
  effective: boolean;
  requiresReconsent: boolean;
  acceptedVersion: string | null;
  grantedAt: string | null;
  revokedAt: string | null;
}
interface HistoryEntry {
  purpose: string;
  action: string;
  version: string;
  textHash: string;
  source: string;
}

// ROADMAP.md O15 / docs/security/ACTIVIDAD_5.md §1 — consent per purpose:
// registration, query, history, revocation and how revocation reaches the
// processes that depend on it.
describe('Consent management (e2e)', () => {
  let app: INestApplication<App>;
  let prisma: PrismaService;
  const email = new FakeEmailProvider();
  const stamp = Date.now();
  let player: TestAccount;
  let other: TestAccount;
  let purposes: PurposeView[];
  const http = () => request(app.getHttpServer());
  const auth = (t: string) => ({ Authorization: `Bearer ${t}` });
  const versionOf = (code: string) =>
    purposes.find((p) => p.code === code)!.version;
  const mine = async (token: string) =>
    (await http().get('/consents/me').set(auth(token)).expect(200))
      .body as ConsentView[];
  const statusOf = async (token: string, code: string) =>
    (await mine(token)).find((c) => c.purpose === code)!;

  beforeAll(async () => {
    app = await createApp(withFakeEmail(email));
    prisma = app.get(PrismaService);
    player = await registerAndLogin(
      app,
      `cs-player-${stamp}@example.com`,
      'CS Player',
    );
    other = await registerAndLogin(
      app,
      `cs-other-${stamp}@example.com`,
      'CS Other',
    );
    purposes = (await http().get('/consents/purposes').expect(200))
      .body as PurposeView[];
  });
  afterAll(async () => {
    await cleanupUsers(prisma, [player.id, other.id]);
    await app.close();
  });

  it('the purposes and their exact text are public (informed before deciding)', () => {
    expect(purposes.map((p) => p.code).sort()).toEqual([
      'EMAIL_NOTIFICATIONS',
      'LOCATION_DISTANCE',
      'TWO_FACTOR',
    ]);
    for (const p of purposes) expect(p.textHash).toMatch(/^[0-9a-f]{64}$/);
  });

  it('a new account has no consent at all (nothing pre-ticked)', async () => {
    for (const c of await mine(player.token)) {
      expect(c).toMatchObject({ status: 'NONE', effective: false });
    }
    const settings = await prisma.userSettings.findUnique({
      where: { userId: player.id },
    });
    expect(settings).toMatchObject({
      notifyByEmail: false,
      shareLocation: false,
    });
  });

  it('without consent, storing a location is refused (403) and nothing is stored', async () => {
    await http()
      .patch('/users/me/location')
      .set(auth(player.token))
      .send({ lat: -33.45, lng: -70.66 })
      .expect(403);
    const settings = await prisma.userSettings.findUnique({
      where: { userId: player.id },
    });
    expect(settings?.lastLat).toBeNull();
  });

  it('accepting an outdated text version is refused (409)', async () => {
    await http()
      .post('/consents/me/LOCATION_DISTANCE')
      .set(auth(player.token))
      .send({ version: '999' })
      .expect(409);
  });

  it('granting one purpose does not grant any other', async () => {
    const res = await http()
      .post('/consents/me/LOCATION_DISTANCE')
      .set(auth(player.token))
      .send({ version: versionOf('LOCATION_DISTANCE') })
      .expect(201);
    expect(res.body).toMatchObject({ status: 'GRANTED', effective: true });
    expect(await statusOf(player.token, 'EMAIL_NOTIFICATIONS')).toMatchObject({
      status: 'NONE',
      effective: false,
    });
    // ...and the other account is untouched.
    expect(await statusOf(other.token, 'LOCATION_DISTANCE')).toMatchObject({
      status: 'NONE',
    });
  });

  it('with the consent, the location is accepted', async () => {
    await http()
      .patch('/users/me/location')
      .set(auth(player.token))
      .send({ lat: -33.45, lng: -70.66 })
      .expect(200);
  });

  it('EMAIL_NOTIFICATIONS turns the optional offer email on — and only that', async () => {
    await http()
      .post('/consents/me/EMAIL_NOTIFICATIONS')
      .set(auth(player.token))
      .send({ version: versionOf('EMAIL_NOTIFICATIONS') })
      .expect(201);
    const settings = await prisma.userSettings.findUnique({
      where: { userId: player.id },
    });
    expect(settings?.notifyByEmail).toBe(true);
  });

  describe('the optional email follows the consent at send time', () => {
    let cardId: string;
    beforeAll(async () => {
      const card = (
        await http()
          .post('/cards')
          .set(auth(player.token))
          .send({ title: `CS Card ${stamp}`, guessedPrice: 10 })
          .expect(201)
      ).body as { id: string };
      cardId = card.id;
    });
    const offerEmails = () =>
      email.sent.filter(
        (m) => m.to === player.email && m.subject.startsWith('Nueva oferta'),
      );

    it('consent granted → the seller gets "Nueva oferta"', async () => {
      await http()
        .post(`/cards/${cardId}/offers`)
        .set(auth(other.token))
        .send({ amount: 11 })
        .expect(201);
      await new Promise((r) => setTimeout(r, 300));
      expect(offerEmails()).toHaveLength(1);
    });

    it('consent revoked → the next offer sends nothing', async () => {
      await http()
        .delete('/consents/me/EMAIL_NOTIFICATIONS')
        .set(auth(player.token))
        .expect(200);
      await http()
        .post(`/cards/${cardId}/offers`)
        .set(auth(other.token))
        .send({ amount: 12 })
        .expect(201);
      await new Promise((r) => setTimeout(r, 300));
      expect(offerEmails()).toHaveLength(1);
      const settings = await prisma.userSettings.findUnique({
        where: { userId: player.id },
      });
      expect(settings?.notifyByEmail).toBe(false);
    });
  });

  it('revoking LOCATION erases the coordinates, records when, and blocks new ones', async () => {
    const res = await http()
      .delete('/consents/me/LOCATION_DISTANCE')
      .set(auth(player.token))
      .expect(200);
    const view = res.body as ConsentView;
    expect(view).toMatchObject({ status: 'REVOKED', effective: false });
    expect(view.revokedAt).toBeTruthy();
    const settings = await prisma.userSettings.findUnique({
      where: { userId: player.id },
    });
    expect(settings).toMatchObject({
      shareLocation: false,
      lastLat: null,
      lastLng: null,
    });
    await http()
      .patch('/users/me/location')
      .set(auth(player.token))
      .send({ lat: 1, lng: 1 })
      .expect(403);
  });

  it('the history keeps every change, with version, text hash and channel', async () => {
    const history = (
      await http()
        .get('/consents/me/history')
        .set(auth(player.token))
        .expect(200)
    ).body as HistoryEntry[];
    const seq = history
      .slice()
      .reverse()
      .map((h) => `${h.purpose}:${h.action}`);
    expect(seq).toEqual([
      'LOCATION_DISTANCE:GRANTED',
      'EMAIL_NOTIFICATIONS:GRANTED',
      'EMAIL_NOTIFICATIONS:REVOKED',
      'LOCATION_DISTANCE:REVOKED',
    ]);
    const hashOf = (code: string) =>
      purposes.find((p) => p.code === code)!.textHash;
    for (const h of history) {
      expect(h.textHash).toBe(hashOf(h.purpose));
      expect(h.source).toBe('app');
    }
  });

  it('history rows cannot be rewritten, even straight in the database', async () => {
    await expect(
      prisma.$executeRaw`UPDATE "consent_events" SET "action" = 'GRANTED'`,
    ).rejects.toThrow(/cannot be modified/);
  });

  it('a consent given to an older text stops counting until re-accepted', async () => {
    await http()
      .post('/consents/me/LOCATION_DISTANCE')
      .set(auth(player.token))
      .send({ version: versionOf('LOCATION_DISTANCE') })
      .expect(201);
    await prisma.consent.update({
      where: {
        userId_purpose: { userId: player.id, purpose: 'LOCATION_DISTANCE' },
      },
      data: { version: '0' },
    });
    expect(await statusOf(player.token, 'LOCATION_DISTANCE')).toMatchObject({
      status: 'GRANTED',
      requiresReconsent: true,
      effective: false,
    });
    await http()
      .patch('/users/me/location')
      .set(auth(player.token))
      .send({ lat: 1, lng: 1 })
      .expect(403);
  });

  it('TWO_FACTOR cannot be toggled with a bare session — only through the 2FA flow', async () => {
    await http()
      .post('/consents/me/TWO_FACTOR')
      .set(auth(player.token))
      .send({ version: versionOf('TWO_FACTOR') })
      .expect(409);
    await http()
      .delete('/consents/me/TWO_FACTOR')
      .set(auth(player.token))
      .expect(409);
  });

  it('enabling and disabling 2FA records the TWO_FACTOR consent', async () => {
    const setup = await http()
      .post('/auth/2fa/setup')
      .set(auth(other.token))
      .expect(201);
    const secret = (setup.body as { secret: string }).secret;
    await http()
      .post('/auth/2fa/enable')
      .set(auth(other.token))
      .send({ code: await generate({ secret }) })
      .expect(201);
    expect(await statusOf(other.token, 'TWO_FACTOR')).toMatchObject({
      status: 'GRANTED',
      effective: true,
    });
    await http()
      .post('/auth/2fa/disable')
      .set(auth(other.token))
      .send({ code: await generate({ secret }) })
      .expect(201);
    expect(await statusOf(other.token, 'TWO_FACTOR')).toMatchObject({
      status: 'REVOKED',
    });
  });

  it('unknown purposes are 404, and there is no route that takes another user id', async () => {
    await http()
      .post('/consents/me/MARKETING')
      .set(auth(player.token))
      .send({ version: '1' })
      .expect(404);
    await http()
      .get(`/consents/${other.id}`)
      .set(auth(player.token))
      .expect(404);
  });

  it('every route except the public purposes needs a session', async () => {
    await http().get('/consents/me').expect(401);
    await http().get('/consents/me/history').expect(401);
    await http()
      .post('/consents/me/LOCATION_DISTANCE')
      .send({ version: '1' })
      .expect(401);
    await http().delete('/consents/me/LOCATION_DISTANCE').expect(401);
  });

  it('every change is in the audit log — pseudonymized, purpose as the resource', async () => {
    const rows = await prisma.auditLog.findMany({
      where: {
        action: { in: ['consent.grant', 'consent.revoke'] },
        resourceType: 'consent',
      },
    });
    expect(rows.length).toBeGreaterThanOrEqual(5);
    const dump = JSON.stringify(rows, (_k, v: unknown) =>
      typeof v === 'bigint' ? v.toString() : v,
    );
    expect(dump).not.toContain(player.id);
    expect(dump).not.toContain(player.email);
    for (const r of rows) expect(r.hash).toMatch(/^[0-9a-f]{64}$/);
  });
});
