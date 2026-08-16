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

// ROADMAP.md G2 — e2e coverage for F2 (payments), CASH path. Mirrors the
// manual verification F2's own ROADMAP row already did by hand (CASH
// purchase -> immediate PAID, provider CashPaymentProvider, exact IVA
// receipt math 119.00 -> net 100.00/iva 19.00/total 119.00 -> receipt on a
// still-PENDING transaction 400s). MERCADOPAGO isn't covered here — no
// sandbox/access token exists in this repo (see F2's own "not verifiable
// here" note), so a MERCADOPAGO-method transaction is only used below to
// exercise the "not paid yet" receipt guard, staying PENDING via
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
  let buyerToken: string;
  let cardId: string; // sold via CASH
  let pendingCardId: string; // sold via MERCADOPAGO (Noop), stays PENDING

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
    const buyerAuth = await registerAndLogin(buyer, 'G2 Buyer');
    buyerToken = buyerAuth.accessToken;

    const cashCard = await request(app.getHttpServer())
      .post('/cards')
      .set('Authorization', `Bearer ${sellerAuth.accessToken}`)
      .send({ title: 'G2 Test Card (Cash)', guessedPrice: 119.0 })
      .expect(201);
    cardId = (cashCard.body as CardEntity).id;

    const pendingCard = await request(app.getHttpServer())
      .post('/cards')
      .set('Authorization', `Bearer ${sellerAuth.accessToken}`)
      .send({
        title: 'G2 Test Card (MercadoPago, stays pending)',
        guessedPrice: 50.0,
      })
      .expect(201);
    pendingCardId = (pendingCard.body as CardEntity).id;
  });

  afterAll(async () => {
    // Clean up in FK-safe order: transactions -> cards -> refresh tokens -> users.
    const cardIds = [cardId, pendingCardId].filter(Boolean);
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

  it('a CASH purchase settles PAID immediately via CashPaymentProvider', async () => {
    const res = await request(app.getHttpServer())
      .post('/transactions')
      .set('Authorization', `Bearer ${buyerToken}`)
      .send({ cardId, paymentMethod: 'CASH' })
      .expect(201);
    const body = res.body as TransactionEntity;

    expect(body.status).toBe('PAID');
    expect(body.paymentProvider).toBe('CashPaymentProvider');
    expect(body.sellerId).toBe(sellerId);
    expect(body.amount).toBe(119);
  });

  it('the receipt for a PAID transaction has exact IVA math (119.00 -> net 100.00 / iva 19.00 / total 119.00)', async () => {
    const created = await request(app.getHttpServer())
      .post('/transactions')
      .set('Authorization', `Bearer ${buyerToken}`)
      .send({ cardId, paymentMethod: 'CASH' })
      .expect(201);
    const createdId = (created.body as TransactionEntity).id;

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
    // Re-login as the seller and try to buy their own card.
    const login = await request(app.getHttpServer())
      .post('/auth/login')
      .send(seller)
      .expect(201);
    const sellerToken = (login.body as LoginResult).accessToken;

    await request(app.getHttpServer())
      .post('/transactions')
      .set('Authorization', `Bearer ${sellerToken}`)
      .send({ cardId, paymentMethod: 'CASH' })
      .expect(400);
  });

  it('the receipt for a still-PENDING transaction 400s ("not paid yet")', async () => {
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
