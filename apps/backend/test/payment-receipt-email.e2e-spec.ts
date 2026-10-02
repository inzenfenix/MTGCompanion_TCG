import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import request from 'supertest';
import { App } from 'supertest/types';
import { AppModule } from './../src/app.module';
import { PrismaService } from './../src/prisma/prisma.service';
import {
  EMAIL_PROVIDER,
  type EmailProvider,
  type SendEmailInput,
} from './../src/notifications/email-provider.interface';
import type { LoginResult } from './../src/auth/application/auth.service';
import type { UserResponseDto } from './../src/users/presentation/dto/user-response.dto';
import type { CardEntity } from './../src/cards/domain/card.entity';
import type { TransactionEntity } from './../src/transactions/domain/transaction.entity';

// ROADMAP.md J8/J10 — the receipt-email trigger itself, not just that the
// transaction reaches PAID. Overrides EMAIL_PROVIDER with a fake that
// records calls instead of hitting real SMTP/MailHog (same "assert a fake
// EmailProvider was called" pattern J10's own row asks for), so this runs
// without any local mail server.
class FakeEmailProvider implements EmailProvider {
  sent: SendEmailInput[] = [];
  send(input: SendEmailInput): Promise<void> {
    this.sent.push(input);
    return Promise.resolve();
  }
}

describe('Payment receipt email (e2e)', () => {
  let app: INestApplication<App>;
  let prisma: PrismaService;
  let fakeEmail: FakeEmailProvider;
  const stamp = Date.now();
  const seller = {
    email: `j8-seller-${stamp}@example.com`,
    password: 'seller-pass-123',
  };
  const buyer = {
    email: `j8-buyer-${stamp}@example.com`,
    password: 'buyer-pass-123',
  };
  let sellerToken: string;
  let buyerToken: string;
  let cardId: string;

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
    fakeEmail = new FakeEmailProvider();
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    })
      .overrideProvider(EMAIL_PROVIDER)
      .useValue(fakeEmail)
      .compile();

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

    const sellerAuth = await registerAndLogin(seller, 'J8 Seller');
    sellerToken = sellerAuth.accessToken;
    const buyerAuth = await registerAndLogin(buyer, 'J8 Buyer');
    buyerToken = buyerAuth.accessToken;

    const card = await request(app.getHttpServer())
      .post('/cards')
      .set('Authorization', `Bearer ${sellerToken}`)
      .send({ title: 'J8 Receipt Test Card', guessedPrice: 50.0 })
      .expect(201);
    cardId = (card.body as CardEntity).id;
  });

  afterAll(async () => {
    await prisma.transaction.deleteMany({ where: { cardId } });
    await prisma.card.deleteMany({ where: { id: cardId } });
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

  it('confirming a cash payment emails both buyer and seller a matching receipt', async () => {
    // Registration itself sends a welcome email (UserCreatedListener) —
    // clear those out so this assertion is only about the receipt.
    fakeEmail.sent = [];

    const created = await request(app.getHttpServer())
      .post('/transactions')
      .set('Authorization', `Bearer ${buyerToken}`)
      .send({ cardId, paymentMethod: 'CASH' })
      .expect(201);
    const transactionId = (created.body as TransactionEntity).id;

    // The listener runs off an emitted event, not inline in the request —
    // give the event loop a tick to let it actually fire before asserting.
    await request(app.getHttpServer())
      .post(`/transactions/${transactionId}/confirm-cash-received`)
      .set('Authorization', `Bearer ${sellerToken}`)
      .expect(201);
    await new Promise((resolve) => setTimeout(resolve, 50));

    expect(fakeEmail.sent).toHaveLength(2);
    const recipients = fakeEmail.sent.map((e) => e.to).sort();
    expect(recipients).toEqual([buyer.email, seller.email].sort());

    for (const email of fakeEmail.sent) {
      expect(email.subject).toContain('J8 Receipt Test Card');
      expect(email.text).toContain('CASH');
      // 50.00 IVA-inclusive -> net 42.02 / iva 7.98 (19%), same
      // computeIvaBreakdown() math the /receipt endpoint already exposes.
      expect(email.text).toContain('50.00');
      expect(email.html).toContain('J8 Receipt Test Card');
    }
  });
});
