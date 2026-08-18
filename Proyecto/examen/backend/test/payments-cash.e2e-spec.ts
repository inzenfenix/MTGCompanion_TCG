import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import request from 'supertest';
import { App } from 'supertest/types';
import { AppModule } from './../src/app.module';
import { PrismaService } from './../src/prisma/prisma.service';
import type { LoginResult } from './../src/auth/application/auth.service';
import type { UserResponseDto } from './../src/users/presentation/dto/user-response.dto';
import type { CardEntity } from './../src/cards/domain/card.entity';
import type { TransactionEntity } from './../src/transactions/domain/transaction.entity';

// Shape of TransactionsService.getReceipt()'s return value — not a named
// export in src/ (it's built inline), so declared locally just for typing
// this test's assertions.
interface ReceiptResponse {
  transactionId: string;
  net: number;
  iva: number;
  total: number;
  paymentMethod: string;
  disclaimer: string;
}

// ROADMAP.md G2/J6/J7/J9 — e2e coverage for F2 (payments), CASH path.
// Since ownership now actually transfers on PAID (J9), each scenario that
// completes a purchase needs its own card — a card bought once is now
// owned by the buyer, so re-buying the same id would 400 as a
// self-purchase, not because of a test bug. MERCADOPAGO isn't covered here
// — no sandbox/access token exists in this repo (see F2's own "not
// verifiable here" note) — a MERCADOPAGO-method transaction is only used
// below to exercise the "not paid yet" receipt guard, staying PENDING via
// NoopPaymentProvider exactly as F2 already documented.
describe('Payments — CASH (e2e)', () => {
  let app: INestApplication<App>;
  let prisma: PrismaService;
  const stamp = Date.now();
  const seller = {
    email: `g2-seller-${stamp}@example.com`,
    password: 'seller-pass-123',
  };
  const buyer = {
    email: `g2-buyer-${stamp}@example.com`,
    password: 'buyer-pass-123',
  };
  let sellerId: string;
  let sellerToken: string;
  let buyerId: string;
  let buyerToken: string;
  const cardIds: string[] = [];

  async function registerAndLogin(
    user: { email: string; password: string },
    displayName: string,
  ): Promise<{ id: string; accessToken: string }> {
    const register = await request(app.getHttpServer())
      .post('/users/register')
      .send({ email: user.email, password: user.password, displayName })
      .expect(201);
    const login = await request(app.getHttpServer())
      .post('/auth/login')
      .send({ email: user.email, password: user.password })
      .expect(201);
    const registerBody = register.body as UserResponseDto;
    const loginBody = login.body as LoginResult;
    return { id: registerBody.id, accessToken: loginBody.accessToken };
  }

  async function createCard(title: string, guessedPrice: number): Promise<string> {
    const res = await request(app.getHttpServer())
      .post('/cards')
      .set('Authorization', `Bearer ${sellerToken}`)
      .send({ title, guessedPrice })
      .expect(201);
    const id = (res.body as CardEntity).id;
    cardIds.push(id);
    return id;
  }

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication();
    app.useGlobalPipes(
      new ValidationPipe({
        whitelist: true,
        forbidNonWhitelisted: true,
        transform: true,
      }),
    );
    await app.init();
    prisma = app.get(PrismaService);

    const sellerAuth = await registerAndLogin(seller, 'G2 Seller');
    sellerId = sellerAuth.id;
    sellerToken = sellerAuth.accessToken;
    const buyerAuth = await registerAndLogin(buyer, 'G2 Buyer');
    buyerId = buyerAuth.id;
    buyerToken = buyerAuth.accessToken;
  });

  afterAll(async () => {
    // Clean up in FK-safe order: transactions -> cards -> refresh tokens -> users.
    await prisma.transaction.deleteMany({ where: { cardId: { in: cardIds } } });
    await prisma.card.deleteMany({ where: { id: { in: cardIds } } });
    const users = await prisma.user.findMany({
      where: { email: { in: [seller.email, buyer.email] } },
    });
    const userIds = users.map((u) => u.id);
    await prisma.refreshToken.deleteMany({
      where: { userId: { in: userIds } },
    });
    await prisma.user.deleteMany({ where: { id: { in: userIds } } });
    await app.close();
  });

  it('a CASH purchase stays PENDING until the seller confirms it, then transfers ownership', async () => {
    const cardId = await createCard('G2 Test Card (Cash)', 119.0);

    const created = await request(app.getHttpServer())
      .post('/transactions')
      .set('Authorization', `Bearer ${buyerToken}`)
      .send({ cardId, paymentMethod: 'CASH' })
      .expect(201);
    const createdBody = created.body as TransactionEntity;
    expect(createdBody.status).toBe('PENDING');
    expect(createdBody.paymentProvider).toBe('CashPaymentProvider');
    expect(createdBody.sellerId).toBe(sellerId);
    expect(createdBody.amount).toBe(119);

    // Buyer can't confirm their own purchase.
    await request(app.getHttpServer())
      .post(`/transactions/${createdBody.id}/confirm-cash-received`)
      .set('Authorization', `Bearer ${buyerToken}`)
      .expect(403);

    const confirmed = await request(app.getHttpServer())
      .post(`/transactions/${createdBody.id}/confirm-cash-received`)
      .set('Authorization', `Bearer ${sellerToken}`)
      .expect(201);
    expect((confirmed.body as TransactionEntity).status).toBe('PAID');

    // Confirming twice is rejected, not silently idempotent.
    await request(app.getHttpServer())
      .post(`/transactions/${createdBody.id}/confirm-cash-received`)
      .set('Authorization', `Bearer ${sellerToken}`)
      .expect(400);

    const card = await request(app.getHttpServer())
      .get(`/cards/${cardId}`)
      .expect(200);
    expect((card.body as CardEntity).ownerId).toBe(buyerId);
  });

  it('the receipt for a PAID transaction has exact IVA math (119.00 -> net 100.00 / iva 19.00 / total 119.00)', async () => {
    const cardId = await createCard('G2 Test Card (Cash, receipt)', 119.0);
    const created = await request(app.getHttpServer())
      .post('/transactions')
      .set('Authorization', `Bearer ${buyerToken}`)
      .send({ cardId, paymentMethod: 'CASH' })
      .expect(201);
    const createdId = (created.body as TransactionEntity).id;

    await request(app.getHttpServer())
      .post(`/transactions/${createdId}/confirm-cash-received`)
      .set('Authorization', `Bearer ${sellerToken}`)
      .expect(201);

    const receipt = await request(app.getHttpServer())
      .get(`/transactions/${createdId}/receipt`)
      .expect(200);
    const receiptBody = receipt.body as ReceiptResponse;

    expect(receiptBody.net).toBe(100);
    expect(receiptBody.iva).toBe(19);
    expect(receiptBody.total).toBe(119);
    expect(receiptBody.paymentMethod).toBe('CASH');
    expect(typeof receiptBody.disclaimer).toBe('string');
    expect(receiptBody.disclaimer.length).toBeGreaterThan(0);
  });

  it('rejects a self-purchase with 400', async () => {
    const cardId = await createCard('G2 Test Card (self-purchase)', 10.0);

    await request(app.getHttpServer())
      .post('/transactions')
      .set('Authorization', `Bearer ${sellerToken}`)
      .send({ cardId, paymentMethod: 'CASH' })
      .expect(400);
  });

  it('the receipt for a still-PENDING transaction 400s ("not paid yet")', async () => {
    const pendingCardId = await createCard(
      'G2 Test Card (MercadoPago, stays pending)',
      50.0,
    );
    const created = await request(app.getHttpServer())
      .post('/transactions')
      .set('Authorization', `Bearer ${buyerToken}`)
      .send({ cardId: pendingCardId, paymentMethod: 'MERCADOPAGO' })
      .expect(201);
    const createdBody = created.body as TransactionEntity;

    // MERCADOPAGO_ACCESS_TOKEN is unset in this repo's .env -> falls back
    // to NoopPaymentProvider -> stays PENDING, same regression check F2
    // already did by hand.
    expect(createdBody.status).toBe('PENDING');

    await request(app.getHttpServer())
      .get(`/transactions/${createdBody.id}/receipt`)
      .expect(400);
  });
});
