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
import type { CouponEntity } from './../src/coupons/domain/coupon.entity';
import { PRIZE_TIERS } from './../src/coupons/application/coupons.service';

// ROADMAP.md L — e2e coverage for CouponsModule (L3): the spin endpoint
// (real weighted tiers, once-per-24h gate) and the redemption path wired
// into TransactionsService.create() (discount math, single-use, cross-owner
// rejection). Two buyer accounts (buyer/otherBuyer) so "your coupon, not
// mine" is exercised against a real second account, same posture K5 already
// established for decks. Purchases use CASH (no external gateway needed,
// same reasoning payments-cash.e2e-spec.ts already documents) — CASH stays
// PENDING, which is fine here since these tests only care about the
// computed `amount`/redemption bookkeeping, not the PAID transfer itself.
describe('Coupons (e2e)', () => {
  let app: INestApplication<App>;
  let prisma: PrismaService;
  const stamp = Date.now();
  const seller = {
    email: `l3-seller-${stamp}@example.com`,
    password: 'seller-pass-123',
  };
  const buyer = {
    email: `l3-buyer-${stamp}@example.com`,
    password: 'buyer-pass-123',
  };
  const otherBuyer = {
    email: `l3-other-buyer-${stamp}@example.com`,
    password: 'other-pass-123',
  };
  // Spinning is once-per-24h per account (L1) — `buyer`/`otherBuyer` above
  // each spin exactly once across this whole file (the first two tests), so
  // every OTHER test that needs a fresh spin registers its own throwaway
  // account via freshSpinner() instead of fighting the shared accounts'
  // cooldown.
  let sellerToken: string;
  let buyerToken: string;
  let otherBuyerToken: string;
  let spinnerCount = 0;
  const cardIds: string[] = [];
  let randomSpy: jest.SpiedFunction<typeof Math.random>;

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

  async function createCard(
    title: string,
    guessedPrice: number,
  ): Promise<string> {
    const res = await request(app.getHttpServer())
      .post('/cards')
      .set('Authorization', `Bearer ${sellerToken}`)
      .send({ title, guessedPrice })
      .expect(201);
    const id = (res.body as CardEntity).id;
    cardIds.push(id);
    return id;
  }

  /** A fresh, never-spun-before account — sidesteps the 24h cooldown so a test can spin regardless of what earlier tests already did to the shared buyer/otherBuyer accounts. */
  async function freshSpinner(): Promise<string> {
    spinnerCount += 1;
    const account = {
      email: `l3-spinner-${stamp}-${spinnerCount}@example.com`,
      password: 'spinner-pass-123',
    };
    return (await registerAndLogin(account, `L3 Spinner ${spinnerCount}`))
      .accessToken;
  }

  /** Forces pickTier() to land on a specific PRIZE_TIERS index deterministically, instead of spinning until the real RNG happens to land there. */
  function forceTier(index: number) {
    const cumulativeBefore = PRIZE_TIERS.slice(0, index).reduce(
      (sum, t) => sum + t.weight,
      0,
    );
    const totalWeight = PRIZE_TIERS.reduce((sum, t) => sum + t.weight, 0);
    // Land just past the start of this tier's slice — Math.random()'s
    // result gets multiplied by totalWeight in pickTier().
    randomSpy.mockReturnValue((cumulativeBefore + 0.5) / totalWeight);
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

    sellerToken = (await registerAndLogin(seller, 'L3 Seller')).accessToken;
    buyerToken = (await registerAndLogin(buyer, 'L3 Buyer')).accessToken;
    otherBuyerToken = (await registerAndLogin(otherBuyer, 'L3 Other Buyer'))
      .accessToken;
  });

  beforeEach(() => {
    randomSpy = jest.spyOn(Math, 'random');
  });

  afterEach(() => {
    randomSpy.mockRestore();
  });

  afterAll(async () => {
    // Clean up in FK-safe order: coupons (redeemedInTransactionId would
    // otherwise block deleting the transaction it points at) ->
    // transactions -> cards -> refresh tokens -> users.
    const users = await prisma.user.findMany({
      where: {
        OR: [
          { email: { in: [seller.email, buyer.email, otherBuyer.email] } },
          { email: { startsWith: `l3-spinner-${stamp}-` } },
        ],
      },
    });
    const userIds = users.map((u) => u.id);
    await prisma.coupon.deleteMany({
      where: { issuedToUserId: { in: userIds } },
    });
    await prisma.transaction.deleteMany({ where: { cardId: { in: cardIds } } });
    await prisma.card.deleteMany({ where: { id: { in: cardIds } } });
    await prisma.refreshToken.deleteMany({
      where: { userId: { in: userIds } },
    });
    await prisma.user.deleteMany({ where: { id: { in: userIds } } });
    await app.close();
  });

  it('spins and issues a coupon matching one of the 3 real prize tiers, then lists it as available', async () => {
    const spin = await request(app.getHttpServer())
      .post('/coupons/spin')
      .set('Authorization', `Bearer ${buyerToken}`)
      .expect(201);
    const coupon = spin.body as CouponEntity;
    expect(
      PRIZE_TIERS.some(
        (t) =>
          t.discountPercent === coupon.discountPercent &&
          t.maxDiscount === coupon.maxDiscount,
      ),
    ).toBe(true);
    expect(coupon.redeemedAt).toBeNull();

    const list = await request(app.getHttpServer())
      .get('/coupons')
      .set('Authorization', `Bearer ${buyerToken}`)
      .expect(200);
    expect((list.body as CouponEntity[]).some((c) => c.id === coupon.id)).toBe(
      true,
    );
  });

  it('rejects a second spin inside the 24h cooldown', async () => {
    await request(app.getHttpServer())
      .post('/coupons/spin')
      .set('Authorization', `Bearer ${otherBuyerToken}`)
      .expect(201);

    await request(app.getHttpServer())
      .post('/coupons/spin')
      .set('Authorization', `Bearer ${otherBuyerToken}`)
      .expect(400);
  });

  it('rejects spinning without auth', async () => {
    await request(app.getHttpServer()).post('/coupons/spin').expect(401);
  });

  it('redeeming a coupon discounts a real purchase (20% off capped at $25 on a $200 card -> $175), and the coupon becomes single-use', async () => {
    const redeemerToken = await freshSpinner();
    forceTier(2); // 20% off, capped at $25
    const spin = await request(app.getHttpServer())
      .post('/coupons/spin')
      .set('Authorization', `Bearer ${redeemerToken}`)
      .expect(201);
    const coupon = spin.body as CouponEntity;
    expect(coupon.discountPercent).toBe(20);
    expect(coupon.maxDiscount).toBe(25);

    const cardId = await createCard('L3 Test Card (coupon)', 200.0);
    const purchase = await request(app.getHttpServer())
      .post('/transactions')
      .set('Authorization', `Bearer ${redeemerToken}`)
      .send({ cardId, paymentMethod: 'CASH', couponId: coupon.id })
      .expect(201);
    const transaction = purchase.body as TransactionEntity;
    // 20% of 200 = 40, capped at 25 -> 200 - 25 = 175.
    expect(transaction.amount).toBe(175);

    // No longer offered as available once redeemed.
    const list = await request(app.getHttpServer())
      .get('/coupons')
      .set('Authorization', `Bearer ${redeemerToken}`)
      .expect(200);
    expect((list.body as CouponEntity[]).some((c) => c.id === coupon.id)).toBe(
      false,
    );

    // Reusing it on a second purchase is rejected, not silently ignored.
    const secondCardId = await createCard('L3 Test Card (reuse attempt)', 50.0);
    await request(app.getHttpServer())
      .post('/transactions')
      .set('Authorization', `Bearer ${redeemerToken}`)
      .send({
        cardId: secondCardId,
        paymentMethod: 'CASH',
        couponId: coupon.id,
      })
      .expect(400);
  });

  it("rejects redeeming someone else's coupon with 404", async () => {
    const ownerToken = await freshSpinner();
    const intruderToken = await freshSpinner();
    forceTier(0); // 5% off, capped at $5
    const spin = await request(app.getHttpServer())
      .post('/coupons/spin')
      .set('Authorization', `Bearer ${ownerToken}`)
      .expect(201);
    const coupon = spin.body as CouponEntity;

    const cardId = await createCard('L3 Test Card (cross-owner coupon)', 30.0);
    await request(app.getHttpServer())
      .post('/transactions')
      .set('Authorization', `Bearer ${intruderToken}`)
      .send({ cardId, paymentMethod: 'CASH', couponId: coupon.id })
      .expect(404);
  });

  it('a purchase without a couponId is unaffected (no discount applied)', async () => {
    const cardId = await createCard('L3 Test Card (no coupon)', 42.5);
    const purchase = await request(app.getHttpServer())
      .post('/transactions')
      .set('Authorization', `Bearer ${buyerToken}`)
      .send({ cardId, paymentMethod: 'CASH' })
      .expect(201);
    expect((purchase.body as TransactionEntity).amount).toBe(42.5);
  });

  // ROADMAP.md L6 — dev-only reset. No other e2e file touches the Coupon
  // table (confirmed via grep before adding this), so this test's global
  // deleteMany({}) can't race a parallel jest worker running another spec.
  // Placed last in this file for the same reason.
  it('L6: dev-reset-all deletes every coupon, no JWT required, gated to non-production only', async () => {
    const freshToken = await freshSpinner();
    const spin = await request(app.getHttpServer())
      .post('/coupons/spin')
      .set('Authorization', `Bearer ${freshToken}`)
      .expect(201);
    const coupon = spin.body as CouponEntity;

    const reset = await request(app.getHttpServer())
      .delete('/coupons/dev-reset-all')
      .expect(200);
    expect((reset.body as { deleted: number }).deleted).toBeGreaterThan(0);

    const list = await request(app.getHttpServer())
      .get('/coupons')
      .set('Authorization', `Bearer ${freshToken}`)
      .expect(200);
    expect(
      (list.body as CouponEntity[]).some((c) => c.id === coupon.id),
    ).toBe(false);
  });
});
