import type { AddressInfo } from 'node:net';
import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import request from 'supertest';
import { App } from 'supertest/types';
import { io, type Socket } from 'socket.io-client';
import { AppModule } from './../src/app.module';
import { PrismaService } from './../src/prisma/prisma.service';
import type { LoginResult } from './../src/auth/application/auth.service';
import type { UserResponseDto } from './../src/users/presentation/dto/user-response.dto';
import type { CardEntity } from './../src/cards/domain/card.entity';

interface AuctionUpdatePayload {
  cardId: string;
  offer: { id: string; cardId: string; bidderId: string; amount: number };
  closesAt: string;
}

// ROADMAP.md J13 — e2e coverage for the real-time auction broadcast: a
// client that joined a card's room over the socket sees a live
// 'auction-update' the instant OffersService.placeOffer (a plain REST
// call) creates a new offer — confirms the EventEmitter2 -> OffersGateway
// wiring actually fires, not just that it compiles.
describe('Offers real-time (e2e)', () => {
  let app: INestApplication<App>;
  let prisma: PrismaService;
  let baseUrl: string;
  const stamp = Date.now();
  const seller = {
    email: `j13-seller-${stamp}@example.com`,
    password: 'seller-pass-123',
  };
  const bidder = {
    email: `j13-bidder-${stamp}@example.com`,
    password: 'bidder-pass-123',
  };
  let bidderToken: string;
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
    // Socket.IO needs a real bound port — supertest alone (no .listen())
    // is enough for the REST assertions elsewhere in this repo, but not
    // for a real socket.io-client connection.
    await app.listen(0);
    const httpServer: { address(): AddressInfo | string | null } =
      app.getHttpServer() as { address(): AddressInfo | string | null };
    const address = httpServer.address();
    const port = address && typeof address === 'object' ? address.port : 0;
    baseUrl = `http://127.0.0.1:${port}`;
    prisma = app.get(PrismaService);

    const sellerAuth = await registerAndLogin(seller, 'J13 Seller');
    const bidderAuth = await registerAndLogin(bidder, 'J13 Bidder');
    bidderToken = bidderAuth.accessToken;

    const card = await request(app.getHttpServer())
      .post('/cards')
      .set('Authorization', `Bearer ${sellerAuth.accessToken}`)
      .send({ title: 'J13 Test Card', guessedPrice: 10.0 })
      .expect(201);
    cardId = (card.body as CardEntity).id;
  });

  afterAll(async () => {
    await prisma.offer.deleteMany({ where: { cardId } });
    await prisma.card.deleteMany({ where: { id: cardId } });
    const users = await prisma.user.findMany({
      where: { email: { in: [seller.email, bidder.email] } },
    });
    const userIds = users.map((u) => u.id);
    await prisma.refreshToken.deleteMany({
      where: { userId: { in: userIds } },
    });
    await prisma.user.deleteMany({ where: { id: { in: userIds } } });
    await app.close();
  });

  it('a client that joined the room sees a live auction-update when a new offer is placed', async () => {
    const client: Socket = io(baseUrl, { transports: ['websocket'] });
    await new Promise<void>((resolve, reject) => {
      client.on('connect', () => resolve());
      client.on('connect_error', reject);
    });
    client.emit('join-auction', { cardId });

    const updatePromise = new Promise<AuctionUpdatePayload>((resolve) => {
      client.on('auction-update', (payload: AuctionUpdatePayload) =>
        resolve(payload),
      );
    });

    await request(app.getHttpServer())
      .post(`/cards/${cardId}/offers`)
      .set('Authorization', `Bearer ${bidderToken}`)
      .send({ amount: 15.0 })
      .expect(201);

    const update = await updatePromise;
    expect(update.cardId).toBe(cardId);
    expect(update.offer.amount).toBe(15);
    expect(update.offer.cardId).toBe(cardId);
    expect(typeof update.closesAt).toBe('string');

    client.disconnect();
  });

  it("a client in a DIFFERENT card's room does not get another card's update", async () => {
    const otherCard = await request(app.getHttpServer())
      .post('/cards')
      .set('Authorization', `Bearer ${bidderToken}`)
      .send({ title: 'J13 Unrelated Card', guessedPrice: 5.0 })
      .expect(201);
    const otherCardId = (otherCard.body as CardEntity).id;

    const client: Socket = io(baseUrl, { transports: ['websocket'] });
    await new Promise<void>((resolve, reject) => {
      client.on('connect', () => resolve());
      client.on('connect_error', reject);
    });
    client.emit('join-auction', { cardId: otherCardId });

    let received = false;
    client.on('auction-update', () => {
      received = true;
    });

    await request(app.getHttpServer())
      .post(`/cards/${cardId}/offers`)
      .set('Authorization', `Bearer ${bidderToken}`)
      .send({ amount: 20.0 })
      .expect(201);

    // No reliable "nothing happened" signal other than a short wait — same
    // tradeoff any negative-event assertion has.
    await new Promise((resolve) => setTimeout(resolve, 300));
    expect(received).toBe(false);

    client.disconnect();
    await prisma.card.deleteMany({ where: { id: otherCardId } });
  });
});
