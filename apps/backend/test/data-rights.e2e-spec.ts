import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { App } from 'supertest/types';
import { PrismaService } from './../src/prisma/prisma.service';
import {
  cleanupUsers,
  createApp,
  FakeEmailProvider,
  registerAndLogin,
  stepUp,
  TEST_PASSWORD,
  withFakeEmail,
  type TestAccount,
} from './helpers/o14-helpers';

interface RequestView {
  id: string;
  type: string;
  status: string;
  outcome: string | null;
  message: string | null;
  verificationMethod: string | null;
  details: Record<string, unknown> | null;
  receivedAt: string;
  verifiedAt: string | null;
  evaluatedAt: string | null;
  executedAt: string | null;
  closedAt: string | null;
  dueAt: string;
}
interface SubmitResult {
  request: RequestView;
  export?: Record<string, unknown> & {
    account: { email: string };
    transactions: { counterparty: string }[];
  };
}

const DAY = 24 * 60 * 60 * 1000;

// ROADMAP.md O15 / docs/security/ACTIVIDAD_5.md §2 — access/portability,
// rectification and erasure, with identity verification and the recorded
// request lifecycle. Each operation is checked for its controls, not just
// that "the button works".
describe('Data-subject rights (e2e)', () => {
  let app: INestApplication<App>;
  let prisma: PrismaService;
  const mail = new FakeEmailProvider();
  const stamp = Date.now();
  const http = () => request(app.getHttpServer());
  const auth = (t: string) => ({ Authorization: `Bearer ${t}` });
  const ids: string[] = [];
  let alice: TestAccount; // the subject
  let bob: TestAccount; // a counterparty / another user
  const account = async (tag: string, name: string) => {
    const a = await registerAndLogin(
      app,
      `dr-${tag}-${stamp}@example.com`,
      name,
    );
    ids.push(a.id);
    return a;
  };
  const submit = (token: string, body: object) =>
    http().post('/data-rights/requests').set(auth(token)).send(body);

  beforeAll(async () => {
    app = await createApp(withFakeEmail(mail));
    prisma = app.get(PrismaService);
    alice = await account('alice', 'DR Alice');
    bob = await account('bob', 'DR Bob');
    // A closed sale between them, so the export has a counterparty in it.
    const card = await http()
      .post('/cards')
      .set(auth(bob.token))
      .send({
        title: `DR Card ${stamp}`,
        guessedPrice: 7,
        description: 'bob notes',
      })
      .expect(201);
    await prisma.transaction.create({
      data: {
        cardId: (card.body as { id: string }).id,
        buyerId: alice.id,
        sellerId: bob.id,
        amount: 7,
        status: 'PAID',
        paymentMethod: 'CASH',
      },
    });
  });
  afterAll(async () => {
    await cleanupUsers(prisma, ids);
    await app.close();
  });

  describe('identity verification (step-up)', () => {
    it('a wrong password is refused and audited', async () => {
      await http()
        .post('/auth/step-up')
        .set(auth(alice.token))
        .send({ password: 'not-the-password' })
        .expect(401);
    });

    it('ACCESS without step-up is received, then closed DENIED — no data handed out', async () => {
      const res = await submit(alice.token, { type: 'ACCESS' }).expect(201);
      const body = res.body as SubmitResult;
      expect(body.export).toBeUndefined();
      expect(body.request).toMatchObject({
        status: 'CLOSED',
        outcome: 'DENIED',
        details: { reason: 'IDENTITY_NOT_VERIFIED' },
        verifiedAt: null,
      });
    });

    it('a step-up token is not a bearer token', async () => {
      const token = await stepUp(app, alice.token);
      await http().get('/consents/me').set(auth(token)).expect(401);
    });

    it("someone else's step-up token doesn't verify you", async () => {
      const bobs = await stepUp(app, bob.token);
      const res = await submit(alice.token, {
        type: 'ACCESS',
        stepUpToken: bobs,
      }).expect(201);
      expect((res.body as SubmitResult).request.details).toEqual({
        reason: 'IDENTITY_NOT_VERIFIED',
      });
    });
  });

  describe('access and portability', () => {
    let result: SubmitResult;
    let token: string;
    beforeAll(async () => {
      token = await stepUp(app, alice.token);
      result = (
        await submit(alice.token, {
          type: 'ACCESS',
          stepUpToken: token,
        }).expect(201)
      ).body as SubmitResult;
    });

    it('walks every stage and records each date, with the 30-day legal deadline', () => {
      const r = result.request;
      expect(r).toMatchObject({
        status: 'CLOSED',
        outcome: 'FULFILLED',
        verificationMethod: 'password',
      });
      for (const k of [
        'receivedAt',
        'verifiedAt',
        'evaluatedAt',
        'executedAt',
        'closedAt',
      ]) {
        expect(r[k as keyof RequestView]).toBeTruthy();
      }
      const due =
        new Date(r.dueAt).getTime() - new Date(r.receivedAt).getTime();
      expect(Math.round(due / DAY)).toBe(30);
    });

    it('the export is structured JSON with the subject’s own data and processing info', () => {
      const e = result.export!;
      expect(e.format).toBe('mtg-companion/personal-data-export');
      expect(e.account.email).toBe(alice.email);
      for (const section of [
        'settings',
        'consents',
        'cards',
        'transactions',
        'processing',
        'notIncluded',
      ]) {
        expect(e).toHaveProperty(section);
      }
      expect(e.transactions[0].counterparty).toBe('DR Bob');
    });

    it('…and nothing that is not theirs to take: no secrets, no third-party identifiers', () => {
      // The data sections — `notIncluded` names what's left out on purpose.
      const data: Record<string, unknown> = { ...result.export! };
      delete data.notIncluded;
      delete data.processing;
      const dump = JSON.stringify(data);
      for (const forbidden of [
        'passwordHash',
        'twoFactorSecret',
        'tokenHash',
        'paymentRef',
        'v1:',
      ]) {
        expect(dump).not.toContain(forbidden);
      }
      expect(dump).not.toContain(bob.email);
      expect(dump).not.toContain(bob.id);
      expect(dump).not.toContain('bob notes');
    });

    it('the export is not stored anywhere — only the section names', async () => {
      const row = await prisma.dataRightsRequest.findUniqueOrThrow({
        where: { id: result.request.id },
      });
      expect(JSON.stringify(row.details)).not.toContain(alice.email);
    });

    it('the same step-up token cannot back a second request (single use)', async () => {
      const res = await submit(alice.token, {
        type: 'ACCESS',
        stepUpToken: token,
      }).expect(201);
      expect((res.body as SubmitResult).request.details).toEqual({
        reason: 'STEP_UP_REUSED',
      });
    });

    it('the answer is sent in writing to the player (art. 11)', () => {
      expect(
        mail.sent.some(
          (m) =>
            m.to === alice.email &&
            m.subject.includes(result.request.id.slice(0, 8)),
        ),
      ).toBe(true);
    });

    it("another player's request id is a 404, not a 403", async () => {
      await http()
        .get(`/data-rights/requests/${result.request.id}`)
        .set(auth(bob.token))
        .expect(404);
      await http()
        .get(`/data-rights/requests/${result.request.id}`)
        .set(auth(alice.token))
        .expect(200);
    });
  });

  describe('rectification', () => {
    it('a low-risk field needs only the session, and the audit keeps the field name, not the value', async () => {
      const res = await submit(alice.token, {
        type: 'RECTIFICATION',
        rectification: { displayName: 'DR Alicia' },
      }).expect(201);
      expect((res.body as SubmitResult).request).toMatchObject({
        outcome: 'FULFILLED',
        details: { fields: ['displayName'] },
        verificationMethod: 'session',
      });
      const audit = await prisma.auditLog.findFirst({
        where: {
          action: 'data.rectify',
          resourceRef: (res.body as SubmitResult).request.id,
        },
      });
      expect(audit?.reason).toBe('displayName');
      expect(
        JSON.stringify(audit, (_k, v: unknown) =>
          typeof v === 'bigint' ? 0 : v,
        ),
      ).not.toContain('DR Alicia');
    });

    it('it propagates: the counterparty now sees the new name on the shared transaction', async () => {
      const tx = await prisma.transaction.findFirstOrThrow({
        where: { buyerId: alice.id },
        include: { buyer: { select: { displayName: true } } },
      });
      expect(tx.buyer.displayName).toBe('DR Alicia');
    });

    it('the same validation rules as registration apply (no contact data in the alias)', async () => {
      await submit(alice.token, {
        type: 'RECTIFICATION',
        rectification: { displayName: 'llámame +56 9 1234 5678' },
      }).expect(400);
      await submit(alice.token, {
        type: 'RECTIFICATION',
        rectification: { role: 'ADMIN' },
      }).expect(400);
    });

    it('an email change without step-up is denied', async () => {
      const res = await submit(alice.token, {
        type: 'RECTIFICATION',
        rectification: { email: `dr-alice-new-${stamp}@example.com` },
      }).expect(201);
      expect((res.body as SubmitResult).request.details).toEqual({
        reason: 'IDENTITY_NOT_VERIFIED',
      });
    });

    it("someone else's email is refused (unique)", async () => {
      const res = await submit(alice.token, {
        type: 'RECTIFICATION',
        stepUpToken: await stepUp(app, alice.token),
        rectification: { email: bob.email },
      }).expect(201);
      expect((res.body as SubmitResult).request.details).toEqual({
        reason: 'EMAIL_IN_USE',
      });
    });

    it('with step-up the email changes, every session ends and the OLD address is warned', async () => {
      const newEmail = `dr-alice-new-${stamp}@example.com`;
      const oldEmail = alice.email;
      const res = await submit(alice.token, {
        type: 'RECTIFICATION',
        stepUpToken: await stepUp(app, alice.token),
        rectification: { email: newEmail },
      }).expect(201);
      expect((res.body as SubmitResult).request.details).toEqual({
        fields: ['email'],
      });
      await new Promise((r) => setTimeout(r, 1100)); // next second (iat granularity)
      await http().get('/consents/me').set(auth(alice.token)).expect(401);
      const user = await prisma.user.findUniqueOrThrow({
        where: { id: alice.id },
      });
      expect(user).toMatchObject({ email: newEmail, emailVerifiedAt: null });
      expect(
        mail.sent.some(
          (m) => m.to === oldEmail && /correo de tu cuenta/.test(m.subject),
        ),
      ).toBe(true);
      const login = await http()
        .post('/auth/login')
        .send({ email: newEmail, password: TEST_PASSWORD })
        .expect(201);
      alice = {
        ...alice,
        email: newEmail,
        token: (login.body as { accessToken: string }).accessToken,
      };
    });
  });

  describe('erasure', () => {
    it('must be explicitly confirmed', async () => {
      await submit(alice.token, {
        type: 'ERASURE',
        stepUpToken: await stepUp(app, alice.token),
      }).expect(400);
    });

    it('is denied, with the reason, while a purchase is still pending', async () => {
      const carol = await account('carol', 'DR Carol');
      const card = await http()
        .post('/cards')
        .set(auth(bob.token))
        .send({ title: `DR Pending ${stamp}`, guessedPrice: 3 })
        .expect(201);
      await prisma.transaction.create({
        data: {
          cardId: (card.body as { id: string }).id,
          buyerId: carol.id,
          sellerId: bob.id,
          amount: 3,
          status: 'PENDING',
          paymentMethod: 'CASH',
        },
      });
      const res = await submit(carol.token, {
        type: 'ERASURE',
        confirmErasure: true,
        stepUpToken: await stepUp(app, carol.token),
      }).expect(201);
      expect((res.body as SubmitResult).request).toMatchObject({
        outcome: 'DENIED',
        details: { reason: 'OPEN_TRANSACTIONS' },
      });
      expect((res.body as SubmitResult).request.message).toMatch(/pendientes/);
      expect(
        await prisma.user.findUnique({ where: { id: carol.id } }),
      ).not.toBeNull();
    });

    it('is denied for a staff account until another ADMIN removes the role', async () => {
      const sam = await account('sam', 'DR Support');
      await prisma.user.update({
        where: { id: sam.id },
        data: { role: 'SUPPORT' },
      });
      const res = await submit(sam.token, {
        type: 'ERASURE',
        confirmErasure: true,
        stepUpToken: await stepUp(app, sam.token),
      }).expect(201);
      expect((res.body as SubmitResult).request.details).toEqual({
        reason: 'ADMIN_ROLE',
      });
    });

    it('with no transactions, the account disappears entirely — the request record stays', async () => {
      const dave = await account('dave', 'DR Dave');
      await http()
        .post('/cards')
        .set(auth(dave.token))
        .send({ title: `DR Dave Card ${stamp}`, guessedPrice: 1 })
        .expect(201);
      const res = await submit(dave.token, {
        type: 'ERASURE',
        confirmErasure: true,
        stepUpToken: await stepUp(app, dave.token),
      }).expect(201);
      const r = (res.body as SubmitResult).request;
      expect(r).toMatchObject({
        outcome: 'FULFILLED',
        details: { mode: 'delete', cardsDeleted: 1 },
      });
      expect(
        await prisma.user.findUnique({ where: { id: dave.id } }),
      ).toBeNull();
      expect(await prisma.card.count({ where: { ownerId: dave.id } })).toBe(0);
      expect(
        await prisma.dataRightsRequest.findUnique({ where: { id: r.id } }),
      ).not.toBeNull();
      await http().get('/consents/me').set(auth(dave.token)).expect(401);
    });

    it('with closed transactions, the account becomes an anonymous tombstone', async () => {
      const res = await submit(alice.token, {
        type: 'ERASURE',
        confirmErasure: true,
        stepUpToken: await stepUp(app, alice.token),
      }).expect(201);
      expect((res.body as SubmitResult).request).toMatchObject({
        outcome: 'FULFILLED',
        details: { mode: 'tombstone' },
      });
      const user = await prisma.user.findUniqueOrThrow({
        where: { id: alice.id },
        include: { settings: true, consents: true },
      });
      expect(user.email).toMatch(/^erased-.*@erased\.invalid$/);
      expect(user).toMatchObject({
        displayName: 'Cuenta eliminada',
        settings: null,
        consents: [],
      });
      expect(user.deletedAt).not.toBeNull();
      // The sale record survives (tax obligation), now pointing at the tombstone.
      expect(
        await prisma.transaction.count({ where: { buyerId: alice.id } }),
      ).toBe(1);
      // The erased data can't be used any more: no session, no login.
      await http().get('/consents/me').set(auth(alice.token)).expect(401);
      await http()
        .post('/auth/login')
        .send({ email: alice.email, password: TEST_PASSWORD })
        .expect(401);
    });

    it('the counterparty’s own export now shows "Cuenta eliminada"', async () => {
      const res = await submit(bob.token, {
        type: 'ACCESS',
        stepUpToken: await stepUp(app, bob.token),
      }).expect(201);
      const counterparties = (
        res.body as SubmitResult
      ).export!.transactions.map((t) => t.counterparty);
      expect(counterparties).toContain('Cuenta eliminada');
      expect(JSON.stringify(res.body)).not.toContain('DR Alicia');
    });
  });

  describe('staff follow-up', () => {
    it('USER → 403; SUPPORT sees deadlines with pseudonyms only', async () => {
      await http()
        .get('/admin/data-rights/requests')
        .set(auth(bob.token))
        .expect(403);
      const sue = await account('sue', 'DR Sue');
      await prisma.user.update({
        where: { id: sue.id },
        data: { role: 'SUPPORT' },
      });
      const res = await http()
        .get('/admin/data-rights/requests')
        .set(auth(sue.token))
        .expect(200);
      const rows = res.body as Record<string, unknown>[];
      expect(rows.length).toBeGreaterThan(0);
      expect(rows[0]).toHaveProperty('subjectPseudonym');
      expect(rows[0]).toHaveProperty('overdue');
      const dump = JSON.stringify(rows);
      expect(dump).not.toContain(bob.id);
      expect(dump).not.toContain('userId');
    });
  });
});
