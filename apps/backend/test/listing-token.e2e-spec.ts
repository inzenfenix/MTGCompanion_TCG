import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import request from 'supertest';
import { App } from 'supertest/types';
import { AppModule } from './../src/app.module';
import { PrismaService } from './../src/prisma/prisma.service';
import type { LoginResult } from './../src/auth/application/auth.service';
import type { UserResponseDto } from './../src/users/presentation/dto/user-response.dto';
import type { CardEntity } from './../src/cards/domain/card.entity';

// ROADMAP.md J4 — e2e coverage for the signed QR listing token: a seller
// mints one for their own card, the Buy page (J5) resolves it back to a
// cardId, a non-owner can't mint one for someone else's card, and a
// tampered/garbage token is rejected rather than silently trusted.
describe('Listing token (e2e)', () => {
  let app: INestApplication<App>;
  let prisma: PrismaService;
  const stamp = Date.now();
  const owner = {
    email: `j4-owner-${stamp}@example.com`,
    password: 'owner-pass-123',
  };
  const other = {
    email: `j4-other-${stamp}@example.com`,
    password: 'other-pass-123',
  };
  let ownerToken: string;
  let otherToken: string;
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

    const ownerAuth = await registerAndLogin(owner, 'J4 Owner');
    ownerToken = ownerAuth.accessToken;
    const otherAuth = await registerAndLogin(other, 'J4 Other');
    otherToken = otherAuth.accessToken;

    const card = await request(app.getHttpServer())
      .post('/cards')
      .set('Authorization', `Bearer ${ownerToken}`)
      .send({ title: 'J4 Test Card', guessedPrice: 25.0 })
      .expect(201);
    cardId = (card.body as CardEntity).id;
  });

  afterAll(async () => {
    await prisma.card.deleteMany({ where: { id: cardId } });
    const users = await prisma.user.findMany({
      where: { email: { in: [owner.email, other.email] } },
    });
    const userIds = users.map((u) => u.id);
    await prisma.refreshToken.deleteMany({
      where: { userId: { in: userIds } },
    });
    await prisma.user.deleteMany({ where: { id: { in: userIds } } });
    await app.close();
  });

  it('the owner mints a token that resolves back to the same cardId', async () => {
    const minted = await request(app.getHttpServer())
      .post(`/cards/${cardId}/listing-token`)
      .set('Authorization', `Bearer ${ownerToken}`)
      .expect(201);
    const token = (minted.body as { token: string }).token;
    expect(typeof token).toBe('string');
    expect(token.length).toBeGreaterThan(0);

    const resolved = await request(app.getHttpServer())
      .get(`/cards/listing-token/${token}`)
      .expect(200);
    expect((resolved.body as { cardId: string }).cardId).toBe(cardId);
  });

  it("a non-owner can't mint a token for someone else's card (404, not confirming the card exists to them)", async () => {
    await request(app.getHttpServer())
      .post(`/cards/${cardId}/listing-token`)
      .set('Authorization', `Bearer ${otherToken}`)
      .expect(404);
  });

  it('a garbage token is rejected with 401, not trusted', async () => {
    await request(app.getHttpServer())
      .get('/cards/listing-token/not-a-real-token')
      .expect(401);
  });

  it("a minted listing token can't be used as a bearer access token on a guarded route", async () => {
    const minted = await request(app.getHttpServer())
      .post(`/cards/${cardId}/listing-token`)
      .set('Authorization', `Bearer ${ownerToken}`)
      .expect(201);
    const token = (minted.body as { token: string }).token;

    await request(app.getHttpServer())
      .patch(`/cards/${cardId}`)
      .set('Authorization', `Bearer ${token}`)
      .send({ title: 'should not work' })
      .expect(401);
  });
});
