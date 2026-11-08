import { INestApplication } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import request from 'supertest';
import { App } from 'supertest/types';
import {
  ADMIN_REPOSITORY,
  type AdminRepository,
} from './../src/admin/domain/admin.repository';
import {
  OFFER_RECEIVED_EVENT,
  OfferReceivedEvent,
} from './../src/common/events/offer-received.event';
import { DataRightsService } from './../src/data-rights/application/data-rights.service';
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

interface RequestView {
  id: string;
  type: string;
  status: string;
  outcome: string | null;
  message: string | null;
  channel: string;
  scope: string | null;
  verificationMethod: string | null;
  details: Record<string, unknown> | null;
  receivedAt: string;
  closedAt: string | null;
  dueAt: string;
  expiresAt: string | null;
}
interface Controls {
  objections: { code: string; active: boolean }[];
  blocking: { active: boolean; basis: string | null };
  history: { kind: string; status: string; liftReason: string | null }[];
}

const DAY = 24 * 60 * 60 * 1000;
const CODE_RE = /^[A-Za-z0-9_-]{43}$/m;

// ROADMAP.md O16 / docs/security/ACTIVIDAD_6.md — public channel, objection
// (art. 8) and blocking (arts. 8 ter, 11). Each mechanism is exercised with a
// concrete request, including requests from someone who isn't verified.
describe('Rights: channel, objection and blocking (e2e)', () => {
  let app: INestApplication<App>;
  let prisma: PrismaService;
  let adminRepo: AdminRepository;
  const mail = new FakeEmailProvider();
  const stamp = Date.now();
  const http = () => request(app.getHttpServer());
  const auth = (t: string) => ({ Authorization: `Bearer ${t}` });
  const ids: string[] = [];
  const account = async (tag: string, name: string) => {
    const a = await registerAndLogin(
      app,
      `o16-${tag}-${stamp}@example.com`,
      name,
    );
    ids.push(a.id);
    return a;
  };
  const submit = (token: string, body: object) =>
    http().post('/data-rights/requests').set(auth(token)).send(body);
  const controls = async (token: string) =>
    (await http().get('/data-rights/controls').set(auth(token)).expect(200))
      .body as Controls;
  const mailTo = async (to: string, subject: RegExp, text?: RegExp) => {
    for (let i = 0; i < 50; i++) {
      const m = mail.sent.find(
        (s) =>
          s.to === to &&
          subject.test(s.subject) &&
          (!text || text.test(s.text)),
      );
      if (m) return m;
      await new Promise((r) => setTimeout(r, 20));
    }
    throw new Error(`no email to ${to} matching ${subject}`);
  };
  const codeFrom = async (to: string) => {
    const m = await mailTo(to, /^Confirma tu solicitud/);
    mail.sent.splice(mail.sent.indexOf(m), 1); // so the next one is found
    return m.text.match(CODE_RE)![0];
  };
  /** Sales in the test-only month 2001-01, straight from the report query. */
  const statsSales = async () =>
    (await adminRepo.paidSalesAggregates())
      .filter((r) => r.month === '2001-01')
      .reduce((n, r) => n + r.sales, 0);
  const listed = async (title: string) =>
    (
      (await http().get('/cards').query({ q: title }).expect(200)).body as {
        title: string;
      }[]
    ).length;

  let sam: TestAccount; // seller
  let bea: TestAccount; // buyer
  let oli: TestAccount; // public-form holder
  let pia: TestAccount; // public-form holder (objection / expiry)
  let eve: TestAccount; // public-form erasure
  let liveCardId: string;
  const liveTitle = `O16 Live ${stamp}`;

  beforeAll(async () => {
    app = await createApp(withFakeEmail(mail));
    prisma = app.get(PrismaService);
    adminRepo = app.get(ADMIN_REPOSITORY);
    sam = await account('sam', 'O16 Sam');
    bea = await account('bea', 'O16 Bea');
    oli = await account('oli', 'O16 Oli');
    pia = await account('pia', 'O16 Pia');
    eve = await account('eve', 'O16 Eve');

    // One listed card, and one paid sale dated in a month only this suite uses.
    liveCardId = (
      (
        await http()
          .post('/cards')
          .set(auth(sam.token))
          .send({ title: liveTitle, guessedPrice: 10 })
          .expect(201)
      ).body as { id: string }
    ).id;
    const sold = await http()
      .post('/cards')
      .set(auth(sam.token))
      .send({ title: `O16 Sold ${stamp}`, guessedPrice: 7 })
      .expect(201);
    await prisma.transaction.create({
      data: {
        cardId: (sold.body as { id: string }).id,
        buyerId: bea.id,
        sellerId: sam.id,
        amount: 7,
        status: 'PAID',
        paymentMethod: 'CASH',
        createdAt: new Date('2001-01-15T12:00:00Z'),
      },
    });
  });
  afterAll(async () => {
    await prisma.dataRightsRequest.deleteMany({
      where: { userId: { in: ids } },
    });
    await cleanupUsers(prisma, ids);
    await app.close();
  });

  // ── 6a. Objection (art. 8) ─────────────────────────────────────────────

  describe('objection', () => {
    it('an unauthenticated request is refused (401)', async () => {
      await http()
        .post('/data-rights/requests')
        .send({ type: 'OBJECTION', purpose: 'SALES_STATISTICS' })
        .expect(401);
    });

    it('must say why (art. 11 d) and name a processing that can be objected to', async () => {
      await submit(bea.token, {
        type: 'OBJECTION',
        purpose: 'SALES_STATISTICS',
      }).expect(400);
      // Consent-based: the way out is revocation, not objection.
      await submit(bea.token, {
        type: 'OBJECTION',
        purpose: 'LOCATION_DISTANCE',
        statement: 'No quiero que usen mi ubicación',
      }).expect(400);
    });

    it('SALES_STATISTICS is upheld and the sales leave the report at once', async () => {
      expect(await statsSales()).toBe(1);
      const res = await submit(bea.token, {
        type: 'OBJECTION',
        purpose: 'SALES_STATISTICS',
        statement: 'No quiero que mis compras se usen para estadísticas.',
      }).expect(201);
      const r = (res.body as { request: RequestView }).request;
      expect(r).toMatchObject({
        type: 'OBJECTION',
        status: 'CLOSED',
        outcome: 'FULFILLED',
        channel: 'APP',
        scope: 'SALES_STATISTICS',
        verificationMethod: 'session',
      });
      expect(
        Math.round((Date.parse(r.dueAt) - Date.parse(r.receivedAt)) / DAY),
      ).toBe(30);
      expect(await statsSales()).toBe(0);
      const c = await controls(bea.token);
      expect(
        c.objections.find((o) => o.code === 'SALES_STATISTICS')!.active,
      ).toBe(true);
      // Written answer (art. 11).
      await mailTo(bea.email, /Respuesta a tu solicitud de oposición/);
    });

    it('a second objection is answered without creating a duplicate', async () => {
      const res = await submit(bea.token, {
        type: 'OBJECTION',
        purpose: 'SALES_STATISTICS',
        statement: 'Lo vuelvo a pedir por si acaso.',
      }).expect(201);
      expect(
        (res.body as { request: RequestView }).request.details,
      ).toMatchObject({ alreadyActive: true });
      expect(
        await prisma.processingControl.count({
          where: { userId: bea.id, status: 'ACTIVE' },
        }),
      ).toBe(1);
    });

    it('withdrawing it puts the sales back in the report; withdrawing twice is 404', async () => {
      await http()
        .delete('/data-rights/controls/objections/SALES_STATISTICS')
        .set(auth(bea.token))
        .expect(200);
      expect(await statsSales()).toBe(1);
      await http()
        .delete('/data-rights/controls/objections/SALES_STATISTICS')
        .set(auth(bea.token))
        .expect(404);
      const c = await controls(bea.token);
      expect(c.history[0]).toMatchObject({
        kind: 'OBJECTION',
        status: 'LIFTED',
        liftReason: 'HOLDER_WITHDREW',
      });
    });

    it('a lifted control cannot be re-activated at the database', async () => {
      const lifted = await prisma.processingControl.findFirstOrThrow({
        where: { userId: bea.id, status: 'LIFTED' },
      });
      await expect(
        prisma.processingControl.update({
          where: { id: lifted.id },
          data: { status: 'ACTIVE' },
        }),
      ).rejects.toThrow();
    });

    it('SECURITY_MONITORING is denied with its grounds (compelling legitimate grounds, art. 8 a)', async () => {
      const res = await submit(bea.token, {
        type: 'OBJECTION',
        purpose: 'SECURITY_MONITORING',
        statement: 'No quiero que registren mis inicios de sesión.',
      }).expect(201);
      const r = (res.body as { request: RequestView }).request;
      expect(r).toMatchObject({
        outcome: 'DENIED',
        details: { reason: 'COMPELLING_GROUNDS' },
      });
      expect(r.message).toMatch(/motivos legítimos imperiosos/);
      // Written, grounded denial + the right to claim before the Agencia.
      const m = await mailTo(
        bea.email,
        /oposición/,
        /motivos legítimos imperiosos/,
      );
      expect(m.text).toMatch(/Agencia/);
      expect(
        await prisma.processingControl.count({
          where: { userId: bea.id, scope: 'SECURITY_MONITORING' },
        }),
      ).toBe(0);
    });
  });

  // ── 6b. Blocking (arts. 8 ter, 11) ─────────────────────────────────────

  describe('blocking', () => {
    it('must be grounded (art. 11)', async () => {
      await submit(sam.token, {
        type: 'BLOCKING',
        blocking: { basis: 'ALTERNATIVE_TO_ERASURE' },
      }).expect(400);
    });

    it('needs an open request of the holder when asked "while pending"', async () => {
      const closed = await submit(sam.token, {
        type: 'RECTIFICATION',
        rectification: { language: 'fr' },
      }).expect(201);
      const closedId = (closed.body as { request: RequestView }).request.id;
      const res = await submit(sam.token, {
        type: 'BLOCKING',
        blocking: { basis: 'PENDING_REQUEST', relatedRequestId: closedId },
        statement: 'Mientras se resuelve mi solicitud.',
      }).expect(201);
      expect((res.body as { request: RequestView }).request.details).toEqual({
        reason: 'NO_PENDING_REQUEST',
      });
    });

    it('as an alternative to erasure: granted, due within 2 business days', async () => {
      expect(await listed(liveTitle)).toBe(1);
      const res = await submit(sam.token, {
        type: 'BLOCKING',
        blocking: { basis: 'ALTERNATIVE_TO_ERASURE' },
        statement:
          'Prefiero suspender el uso de mis datos en vez de borrar la cuenta.',
      }).expect(201);
      const r = (res.body as { request: RequestView }).request;
      expect(r).toMatchObject({
        outcome: 'FULFILLED',
        scope: 'ALTERNATIVE_TO_ERASURE',
      });
      expect(
        Date.parse(r.dueAt) - Date.parse(r.receivedAt),
      ).toBeLessThanOrEqual(4 * DAY);
      expect((await controls(sam.token)).blocking).toMatchObject({
        active: true,
        basis: 'ALTERNATIVE_TO_ERASURE',
      });
    });

    it('stops every covered process…', async () => {
      // Bazaar
      expect(await listed(liveTitle)).toBe(0);
      // New offers and purchases on the seller's cards
      await http()
        .post(`/cards/${liveCardId}/offers`)
        .set(auth(bea.token))
        .send({ amount: 20 })
        .expect(409);
      await http()
        .post('/transactions')
        .set(auth(bea.token))
        .send({ cardId: liveCardId, paymentMethod: 'CASH' })
        .expect(409);
      // Location, even with a current consent
      await grantConsent(app, sam.token, 'LOCATION_DISTANCE');
      await http()
        .patch('/users/me/location')
        .set(auth(sam.token))
        .send({ lat: -33.45, lng: -70.66 })
        .expect(403);
      // Optional email, even with a current consent
      await grantConsent(app, sam.token, 'EMAIL_NOTIFICATIONS');
      const before = mail.sent.length;
      await app
        .get(EventEmitter2)
        .emitAsync(
          OFFER_RECEIVED_EVENT,
          new OfferReceivedEvent(sam.id, liveTitle, 20),
        );
      expect(
        mail.sent.slice(before).filter((m) => m.to === sam.email),
      ).toHaveLength(0);
      // Statistics
      expect(await statsSales()).toBe(0);
    });

    it('…but keeps the data stored and the holder in control of it', async () => {
      const card = await http().get(`/cards/${liveCardId}`).expect(200);
      expect((card.body as { title: string }).title).toBe(liveTitle);
      const token = await stepUp(app, sam.token);
      const exp = await submit(sam.token, {
        type: 'ACCESS',
        stepUpToken: token,
      }).expect(201);
      expect(
        (
          exp.body as {
            export: { processingControls: { kind: string; status: string }[] };
          }
        ).export.processingControls,
      ).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ kind: 'BLOCKING', status: 'ACTIVE' }),
        ]),
      );
    });

    it('lifting it restores the listing, offers and statistics', async () => {
      await http()
        .delete('/data-rights/controls/blocking')
        .set(auth(sam.token))
        .expect(200);
      expect(await listed(liveTitle)).toBe(1);
      expect(await statsSales()).toBe(1);
      await http()
        .post(`/cards/${liveCardId}/offers`)
        .set(auth(bea.token))
        .send({ amount: 20 })
        .expect(201);
    });
  });

  // ── 1–2 + 7. Public channel and unverified requesters ──────────────────

  describe('public contact form', () => {
    it('an address with no account gets the same answer, and a "no data" email', async () => {
      const ghost = `o16-ghost-${stamp}@example.com`;
      const res = await http()
        .post('/data-rights/public-requests')
        .send({ email: ghost, type: 'ACCESS' })
        .expect(202);
      const known = await http()
        .post('/data-rights/public-requests')
        .send({ email: oli.email, type: 'ACCESS' })
        .expect(202);
      expect(res.body).toEqual(known.body); // no account enumeration
      const m = await mailTo(ghost, /Respuesta a tu solicitud/);
      expect(m.text).toMatch(/No encontramos una cuenta/);
      const row = await prisma.dataRightsRequest.findFirstOrThrow({
        where: { userId: null, channel: 'EMAIL_FORM' },
        orderBy: { receivedAt: 'desc' },
      });
      expect(row).toMatchObject({ status: 'CLOSED', outcome: 'DENIED' });
      expect(JSON.stringify(row)).not.toContain(ghost); // pseudonym only
      await prisma.dataRightsRequest.delete({ where: { id: row.id } });
    });

    it('nothing is done before the mailbox confirms; a wrong code is refused', async () => {
      const row = await prisma.dataRightsRequest.findFirstOrThrow({
        where: { userId: oli.id, type: 'ACCESS' },
      });
      expect(row).toMatchObject({
        status: 'AWAITING_CONFIRMATION',
        channel: 'EMAIL_FORM',
        verifiedAt: null,
      });
      expect(row.confirmTokenHash).toMatch(/^[0-9a-f]{64}$/); // only a hash
      await http()
        .post('/data-rights/public-requests/confirm')
        .send({ code: 'x'.repeat(43) })
        .expect(400);
    });

    it('ACCESS: confirmed from the mailbox, then waits for the step-up in the app', async () => {
      const code = await codeFrom(oli.email);
      const res = await http()
        .post('/data-rights/public-requests/confirm')
        .send({ code })
        .expect(200);
      const body = res.body as { request: RequestView; next: string };
      expect(body.next).toBe('COMPLETE_IN_APP');
      expect(body.request).toMatchObject({
        status: 'PENDING_STEP_UP',
        verificationMethod: 'email-link',
      });
      expect(body).not.toHaveProperty('export');
      // single use
      await http()
        .post('/data-rights/public-requests/confirm')
        .send({ code })
        .expect(400);
    });

    it('completing it without the step-up is denied (unverified requester)', async () => {
      const row = await prisma.dataRightsRequest.findFirstOrThrow({
        where: { userId: oli.id, type: 'ACCESS' },
      });
      const res = await http()
        .post(`/data-rights/requests/${row.id}/complete`)
        .set(auth(oli.token))
        .send({})
        .expect(200);
      expect(res.body).toMatchObject({
        request: {
          outcome: 'DENIED',
          details: { reason: 'IDENTITY_NOT_VERIFIED' },
        },
      });
      expect(res.body).not.toHaveProperty('export');
      // and someone else can't complete it at all
      await http()
        .post(`/data-rights/requests/${row.id}/complete`)
        .set(auth(bea.token))
        .send({})
        .expect(404);
    });

    it('RECTIFICATION + blocking: blocked while pending, lifted when resolved', async () => {
      await http()
        .post('/data-rights/public-requests')
        .send({
          email: oli.email,
          type: 'RECTIFICATION',
          statement: 'Mi nombre visible está mal escrito.',
          requestBlocking: true,
        })
        .expect(202);
      const confirmed = await http()
        .post('/data-rights/public-requests/confirm')
        .send({ code: await codeFrom(oli.email) })
        .expect(200);
      const body = confirmed.body as {
        request: RequestView;
        blocking: RequestView;
      };
      expect(body.blocking).toMatchObject({
        type: 'BLOCKING',
        outcome: 'FULFILLED',
        scope: 'PENDING_REQUEST',
      });
      expect((await controls(oli.token)).blocking.active).toBe(true);

      const done = await http()
        .post(`/data-rights/requests/${body.request.id}/complete`)
        .set(auth(oli.token))
        .send({ rectification: { displayName: 'O16 Olivia' } })
        .expect(200);
      expect(done.body).toMatchObject({
        request: { outcome: 'FULFILLED', details: { fields: ['displayName'] } },
      });
      const c = await controls(oli.token);
      expect(c.blocking.active).toBe(false);
      expect(c.history[0]).toMatchObject({
        kind: 'BLOCKING',
        status: 'LIFTED',
        liftReason: 'RELATED_REQUEST_CLOSED',
      });
    });

    it('OBJECTION: the mailbox proof is enough, executed on confirmation', async () => {
      await http()
        .post('/data-rights/public-requests')
        .send({
          email: pia.email,
          type: 'OBJECTION',
          purpose: 'SALES_STATISTICS',
          statement: 'No uso la app y no quiero estar en estadísticas.',
        })
        .expect(202);
      const res = await http()
        .post('/data-rights/public-requests/confirm')
        .send({ code: await codeFrom(pia.email) })
        .expect(200);
      expect(res.body).toMatchObject({
        next: 'DONE',
        request: {
          outcome: 'FULFILLED',
          channel: 'EMAIL_FORM',
          verificationMethod: 'email-link',
        },
      });
    });

    it('an expired code closes the request without doing anything', async () => {
      await http()
        .post('/data-rights/public-requests')
        .send({ email: pia.email, type: 'ERASURE' })
        .expect(202);
      const code = await codeFrom(pia.email);
      await prisma.dataRightsRequest.updateMany({
        where: { userId: pia.id, status: 'AWAITING_CONFIRMATION' },
        data: { expiresAt: new Date(Date.now() - 1000) },
      });
      const res = await http()
        .post('/data-rights/public-requests/confirm')
        .send({ code })
        .expect(200);
      expect(res.body).toMatchObject({
        request: {
          outcome: 'DENIED',
          details: { reason: 'CONFIRMATION_EXPIRED' },
        },
      });
      expect(
        await prisma.user.findUnique({ where: { id: pia.id } }),
      ).not.toBeNull();
    });

    it('the sweep closes unconfirmed requests nobody answered', async () => {
      await http()
        .post('/data-rights/public-requests')
        .send({ email: pia.email, type: 'ACCESS' })
        .expect(202);
      await prisma.dataRightsRequest.updateMany({
        where: { userId: pia.id, status: 'AWAITING_CONFIRMATION' },
        data: { expiresAt: new Date(Date.now() - 1000) },
      });
      expect(
        await app.get(DataRightsService).expireStale(),
      ).toBeGreaterThanOrEqual(1);
      const row = await prisma.dataRightsRequest.findFirstOrThrow({
        where: { userId: pia.id, type: 'ACCESS' },
      });
      expect(row).toMatchObject({ status: 'CLOSED', outcome: 'DENIED' });
    });

    it('caps public requests per address (3 per 24 h): the 4th is dropped silently', async () => {
      // pia already sent 3 today.
      const before = await prisma.dataRightsRequest.count({
        where: { userId: pia.id },
      });
      await http()
        .post('/data-rights/public-requests')
        .send({ email: pia.email, type: 'ACCESS' })
        .expect(202);
      expect(
        await prisma.dataRightsRequest.count({ where: { userId: pia.id } }),
      ).toBe(before);
    });

    it('ERASURE through the form, completed with step-up: erased, request kept without grounds', async () => {
      await http()
        .post('/data-rights/public-requests')
        .send({
          email: eve.email,
          type: 'ERASURE',
          statement: 'Ya no quiero tener cuenta.',
        })
        .expect(202);
      const confirmed = await http()
        .post('/data-rights/public-requests/confirm')
        .send({ code: await codeFrom(eve.email) })
        .expect(200);
      const id = (confirmed.body as { request: RequestView }).request.id;
      // Without the explicit confirmation flag: 400, nothing happens.
      const token = await stepUp(app, eve.token);
      await http()
        .post(`/data-rights/requests/${id}/complete`)
        .set(auth(eve.token))
        .send({ stepUpToken: token })
        .expect(400);
      const res = await http()
        .post(`/data-rights/requests/${id}/complete`)
        .set(auth(eve.token))
        .send({ stepUpToken: token, confirmErasure: true })
        .expect(200);
      expect(res.body).toMatchObject({
        request: {
          outcome: 'FULFILLED',
          verificationMethod: 'email-link+password',
          details: { mode: 'delete' },
        },
      });
      expect(
        await prisma.user.findUnique({ where: { id: eve.id } }),
      ).toBeNull();
      const row = await prisma.dataRightsRequest.findUniqueOrThrow({
        where: { id },
      });
      expect(row.statement).toBeNull();
    });
  });

  it('staff follow-up shows channel and type, never the subject', async () => {
    await prisma.user.update({
      where: { id: sam.id },
      data: { role: 'ADMIN' },
    });
    const res = await http()
      .get('/admin/data-rights/requests')
      .set(auth(sam.token))
      .expect(200);
    const rows = res.body as Record<string, unknown>[];
    expect(rows.some((r) => r.channel === 'EMAIL_FORM')).toBe(true);
    expect(rows.some((r) => r.type === 'OBJECTION')).toBe(true);
    const dump = JSON.stringify(rows);
    for (const a of [bea, oli, pia]) {
      expect(dump).not.toContain(a.id);
      expect(dump).not.toContain(a.email);
    }
    await prisma.user.update({ where: { id: sam.id }, data: { role: 'USER' } });
  });
});
