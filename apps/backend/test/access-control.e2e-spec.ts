import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { App } from 'supertest/types';
import { PrismaService } from './../src/prisma/prisma.service';
import { AuditService } from './../src/common/audit/audit.service';
import type { CardEntity } from './../src/cards/domain/card.entity';
import type { TransactionEntity } from './../src/transactions/domain/transaction.entity';
import {
  cleanupUsers,
  createApp,
  registerAndLogin,
  type TestAccount,
} from './helpers/o14-helpers';

// ROADMAP.md O14 / docs/security/ACTIVIDAD_4.md §5 — RBAC evidence: every
// row of the permission matrix exercised over real HTTP, allowed AND denied.
describe('Access control — authentication, ownership and RBAC (e2e)', () => {
  let app: INestApplication<App>;
  let prisma: PrismaService;
  let audit: AuditService;
  const stamp = Date.now();
  let seller: TestAccount; // USER
  let buyer: TestAccount; // USER
  let outsider: TestAccount; // USER, party to nothing
  let support: TestAccount;
  let admin: TestAccount;
  let txId: string;
  const http = () => request(app.getHttpServer());
  const reason = 'Disputa O14-e2e: carta no recibida';

  beforeAll(async () => {
    app = await createApp();
    prisma = app.get(PrismaService);
    audit = app.get(AuditService);
    seller = await registerAndLogin(
      app,
      `ac-seller-${stamp}@example.com`,
      'AC Seller',
    );
    buyer = await registerAndLogin(
      app,
      `ac-buyer-${stamp}@example.com`,
      'AC Buyer',
    );
    outsider = await registerAndLogin(
      app,
      `ac-outsider-${stamp}@example.com`,
      'AC Outsider',
    );
    support = await registerAndLogin(
      app,
      `ac-support-${stamp}@example.com`,
      'AC Support',
    );
    admin = await registerAndLogin(
      app,
      `ac-admin-${stamp}@example.com`,
      'AC Admin',
    );
    // What src/scripts/set-role.ts does for the first ADMIN (operator, DB access).
    await prisma.user.update({
      where: { id: support.id },
      data: { role: 'SUPPORT' },
    });
    await prisma.user.update({
      where: { id: admin.id },
      data: { role: 'ADMIN' },
    });

    const card = await http()
      .post('/cards')
      .set('Authorization', `Bearer ${seller.token}`)
      .send({ title: 'AC Card', guessedPrice: 10 })
      .expect(201);
    const tx = await http()
      .post('/transactions')
      .set('Authorization', `Bearer ${buyer.token}`)
      .send({ cardId: (card.body as CardEntity).id, paymentMethod: 'CASH' })
      .expect(201);
    txId = (tx.body as TransactionEntity).id;
  });

  afterAll(async () => {
    await cleanupUsers(
      prisma,
      [seller, buyer, outsider, support, admin].map((u) => u.id),
    );
    await app.close();
  });

  describe('authentication (401 without a valid session)', () => {
    it.each([
      ['GET', '/transactions'],
      ['GET', '/admin/users'],
      ['GET', '/admin/audit-logs'],
    ])('%s %s without a token → 401', async (_m, path) => {
      await http().get(path).expect(401);
    });

    it('GET /transactions/:id and its receipt used to be public — now 401', async () => {
      await http().get(`/transactions/${txId}`).expect(401);
      await http().get(`/transactions/${txId}/receipt`).expect(401);
    });

    it('a forged/garbage token → 401', async () => {
      await http()
        .get('/transactions')
        .set('Authorization', 'Bearer not.a.jwt')
        .expect(401);
    });
  });

  describe('USER — own data only', () => {
    it('lists only their own transactions', async () => {
      const res = await http()
        .get('/transactions')
        .set('Authorization', `Bearer ${buyer.token}`)
        .expect(200);
      const txs = res.body as TransactionEntity[];
      expect(txs.map((t) => t.id)).toContain(txId);
      expect(
        txs.every((t) => t.buyerId === buyer.id || t.sellerId === buyer.id),
      ).toBe(true);
    });

    it("?userId=<someone else> is a 403, not someone else's history", async () => {
      await http()
        .get(`/transactions?userId=${seller.id}`)
        .set('Authorization', `Bearer ${outsider.token}`)
        .expect(403);
    });

    it('both parties may read the transaction; anyone else gets 403', async () => {
      await http()
        .get(`/transactions/${txId}`)
        .set('Authorization', `Bearer ${buyer.token}`)
        .expect(200);
      await http()
        .get(`/transactions/${txId}`)
        .set('Authorization', `Bearer ${seller.token}`)
        .expect(200);
      await http()
        .get(`/transactions/${txId}`)
        .set('Authorization', `Bearer ${outsider.token}`)
        .expect(403);
      await http()
        .get(`/transactions/${txId}/receipt`)
        .set('Authorization', `Bearer ${outsider.token}`)
        .expect(403);
    });

    it.each([
      ['GET', '/admin/users'],
      ['GET', '/admin/audit-logs'],
      ['GET', '/admin/reports/sales'],
    ])('USER %s %s → 403', async (_m, path) => {
      await http()
        .get(path)
        .set('Authorization', `Bearer ${outsider.token}`)
        .expect(403);
    });

    it('USER cannot promote themselves → 403', async () => {
      await http()
        .patch(`/admin/users/${outsider.id}/role`)
        .set('Authorization', `Bearer ${outsider.token}`)
        .send({ role: 'ADMIN' })
        .expect(403);
      const row = await prisma.user.findUnique({ where: { id: outsider.id } });
      expect(row?.role).toBe('USER');
    });

    it('denied attempts land in the audit log under a pseudonym, never the raw id', async () => {
      const rows = await prisma.auditLog.findMany({
        where: {
          actorPseudonym: audit.pseudonymOf(outsider.id),
          outcome: 'DENIED',
        },
      });
      expect(rows.length).toBeGreaterThanOrEqual(4);
      // seq (O15) is a BigInt — stringify it.
      const everything = JSON.stringify(
        await prisma.auditLog.findMany(),
        (_k, v: unknown) => (typeof v === 'bigint' ? v.toString() : v),
      );
      expect(everything).not.toContain(outsider.id);
      expect(everything).not.toContain(outsider.email);
    });
  });

  describe('SUPPORT — dispute resolution, nothing administrative', () => {
    it('lists accounts with a masked email, never the full one or any secret', async () => {
      const res = await http()
        .get('/admin/users')
        .set('Authorization', `Bearer ${support.token}`)
        .expect(200);
      const users = res.body as {
        id: string;
        emailMasked: string;
        email?: string;
      }[];
      const row = users.find((u) => u.id === buyer.id);
      expect(row?.emailMasked).toBe('a***@e***.com'); // ac-buyer-…@example.com
      expect(row?.email).toBeUndefined();
      const body = JSON.stringify(users);
      expect(body).not.toContain(buyer.email);
      expect(body).not.toMatch(/passwordHash|twoFactorSecret|lastLat|lastLng/);
    });

    it("needs a reason to read someone's transactions (400 without one)", async () => {
      await http()
        .get(`/admin/users/${buyer.id}/transactions`)
        .set('Authorization', `Bearer ${support.token}`)
        .expect(400);
    });

    it("rejects a 'reason' that carries contact data (400)", async () => {
      await http()
        .get(`/admin/users/${buyer.id}/transactions`)
        .query({ reason: 'llamar al +56 9 1234 5678' })
        .set('Authorization', `Bearer ${support.token}`)
        .expect(400);
    });

    it('with a reason → 200, and the access is audited with that reason', async () => {
      const res = await http()
        .get(`/admin/users/${buyer.id}/transactions`)
        .query({ reason })
        .set('Authorization', `Bearer ${support.token}`)
        .expect(200);
      expect((res.body as TransactionEntity[]).map((t) => t.id)).toContain(
        txId,
      );
      const entry = await prisma.auditLog.findFirst({
        where: {
          action: 'support.transactions.read',
          actorPseudonym: audit.pseudonymOf(support.id),
          targetPseudonym: audit.pseudonymOf(buyer.id),
        },
      });
      expect(entry?.reason).toBe(reason);
      expect(entry?.actorRole).toBe('SUPPORT');
    });

    it('SUPPORT cannot change roles → 403', async () => {
      await http()
        .patch(`/admin/users/${buyer.id}/role`)
        .set('Authorization', `Bearer ${support.token}`)
        .send({ role: 'ADMIN' })
        .expect(403);
    });

    it('SUPPORT cannot read the audit log or the sales report → 403', async () => {
      await http()
        .get('/admin/audit-logs')
        .set('Authorization', `Bearer ${support.token}`)
        .expect(403);
      await http()
        .get('/admin/reports/sales')
        .set('Authorization', `Bearer ${support.token}`)
        .expect(403);
    });

    it('SUPPORT cannot undo a pseudonym → 403', async () => {
      await http()
        .post('/admin/pseudonyms/resolve')
        .set('Authorization', `Bearer ${support.token}`)
        .send({ pseudonym: audit.pseudonymOf(buyer.id), reason })
        .expect(403);
    });
  });

  describe('ADMIN — roles, audit, reports, re-identification', () => {
    it('cannot change their own role (separation of duties) → 400', async () => {
      await http()
        .patch(`/admin/users/${admin.id}/role`)
        .set('Authorization', `Bearer ${admin.token}`)
        .send({ role: 'USER' })
        .expect(400);
    });

    it('rejects a role that does not exist → 400', async () => {
      await http()
        .patch(`/admin/users/${buyer.id}/role`)
        .set('Authorization', `Bearer ${admin.token}`)
        .send({ role: 'ROOT' })
        .expect(400);
    });

    it('reads the audit log — pseudonyms only', async () => {
      const res = await http()
        .get('/admin/audit-logs?limit=500')
        .set('Authorization', `Bearer ${admin.token}`)
        .expect(200);
      const body = JSON.stringify(res.body);
      expect(body).toContain(audit.pseudonymOf(support.id));
      for (const u of [seller, buyer, outsider, support]) {
        expect(body).not.toContain(u.id);
        expect(body).not.toContain(u.email);
      }
    });

    it('resolves a pseudonym back to an account only with a reason, and that is audited too', async () => {
      const pseudonym = audit.pseudonymOf(support.id);
      await http()
        .post('/admin/pseudonyms/resolve')
        .set('Authorization', `Bearer ${admin.token}`)
        .send({ pseudonym })
        .expect(400);
      const res = await http()
        .post('/admin/pseudonyms/resolve')
        .set('Authorization', `Bearer ${admin.token}`)
        .send({ pseudonym, reason: 'Revisión O14-e2e de accesos de soporte' })
        .expect(201);
      expect(res.body).toEqual({
        userId: support.id,
        displayName: 'AC Support',
      });
      const entry = await prisma.auditLog.findFirst({
        where: {
          action: 'admin.pseudonym.resolve',
          targetPseudonym: pseudonym,
        },
      });
      expect(entry).not.toBeNull();
    });

    it('gets the sales report anonymized: k, cells without ids, suppressed count', async () => {
      const res = await http()
        .get('/admin/reports/sales')
        .set('Authorization', `Bearer ${admin.token}`)
        .expect(200);
      const report = res.body as {
        k: number;
        cells: object[];
        suppressedCells: number;
      };
      expect(report.k).toBe(5);
      expect(typeof report.suppressedCells).toBe('number');
      const body = JSON.stringify(report);
      for (const u of [seller, buyer]) expect(body).not.toContain(u.id);
      expect(body).not.toMatch(/buyerId|sellerId|distinctBuyers/);
    });

    it('demoting SUPPORT takes effect on the very next request (role read from the DB, not the token)', async () => {
      await http()
        .get('/admin/users')
        .set('Authorization', `Bearer ${support.token}`)
        .expect(200);
      await http()
        .patch(`/admin/users/${support.id}/role`)
        .set('Authorization', `Bearer ${admin.token}`)
        .send({ role: 'USER' })
        .expect(200);
      // Same, still-unexpired access token as one line above:
      await http()
        .get('/admin/users')
        .set('Authorization', `Bearer ${support.token}`)
        .expect(403);
      const entry = await prisma.auditLog.findFirst({
        where: {
          action: 'admin.role.change',
          targetPseudonym: audit.pseudonymOf(support.id),
        },
      });
      expect(entry?.reason).toBe('SUPPORT -> USER');
    });

    it("a deleted account's still-valid token stops working → 401", async () => {
      const ghost = await registerAndLogin(
        app,
        `ac-ghost-${stamp}@example.com`,
        'AC Ghost',
      );
      await http()
        .get('/transactions')
        .set('Authorization', `Bearer ${ghost.token}`)
        .expect(200);
      await cleanupUsers(prisma, [ghost.id]);
      await http()
        .get('/transactions')
        .set('Authorization', `Bearer ${ghost.token}`)
        .expect(401);
    });
  });
});
