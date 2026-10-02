import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import request from 'supertest';
import { App } from 'supertest/types';
import { AppModule } from './../src/app.module';
import { PrismaService } from './../src/prisma/prisma.service';
import type { LoginResult } from './../src/auth/application/auth.service';
import type { UserResponseDto } from './../src/users/presentation/dto/user-response.dto';
import type { CardEntity } from './../src/cards/domain/card.entity';
import type { DeckEntity } from './../src/decks/domain/deck.entity';

// ROADMAP.md K — e2e coverage for DecksModule (K3) and the deckId-aware
// pieces of CardsModule (deck-filtered GET /cards, deck-aware PATCH
// /cards/:id). Two owners (owner/otherOwner) so cross-ownership checks
// (rename/delete/move-into someone else's deck) are exercised against a
// real second account, not just guessed.
describe('Decks (e2e)', () => {
  let app: INestApplication<App>;
  let prisma: PrismaService;
  const stamp = Date.now();
  const owner = {
    email: `k-owner-${stamp}@example.com`,
    password: 'owner-pass-123',
  };
  const otherOwner = {
    email: `k-other-${stamp}@example.com`,
    password: 'other-pass-123',
  };
  let ownerId: string;
  let ownerToken: string;
  let otherOwnerToken: string;
  const cardIds: string[] = [];
  const deckIds: string[] = [];

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

  async function createCard(token: string, title: string): Promise<string> {
    const res = await request(app.getHttpServer())
      .post('/cards')
      .set('Authorization', `Bearer ${token}`)
      .send({ title, guessedPrice: 5 })
      .expect(201);
    const id = (res.body as CardEntity).id;
    cardIds.push(id);
    return id;
  }

  async function createDeck(token: string, name: string): Promise<string> {
    const res = await request(app.getHttpServer())
      .post('/decks')
      .set('Authorization', `Bearer ${token}`)
      .send({ name })
      .expect(201);
    const id = (res.body as DeckEntity).id;
    deckIds.push(id);
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

    const ownerAuth = await registerAndLogin(owner, 'K Owner');
    ownerId = ownerAuth.id;
    ownerToken = ownerAuth.accessToken;
    const otherAuth = await registerAndLogin(otherOwner, 'K Other Owner');
    otherOwnerToken = otherAuth.accessToken;
  });

  afterAll(async () => {
    // Clean up in FK-safe order: cards (deckId is SET NULL by the FK
    // itself, but the card rows are still ours to delete) -> decks ->
    // refresh tokens -> users.
    await prisma.card.deleteMany({ where: { id: { in: cardIds } } });
    await prisma.deck.deleteMany({ where: { id: { in: deckIds } } });
    const users = await prisma.user.findMany({
      where: { email: { in: [owner.email, otherOwner.email] } },
    });
    const userIds = users.map((u) => u.id);
    await prisma.refreshToken.deleteMany({
      where: { userId: { in: userIds } },
    });
    await prisma.user.deleteMany({ where: { id: { in: userIds } } });
    await app.close();
  });

  it('creates a deck and lists it for its owner', async () => {
    const deckId = await createDeck(ownerToken, 'Modern deck');

    const res = await request(app.getHttpServer())
      .get('/decks')
      .query({ ownerId })
      .expect(200);
    const decks = res.body as DeckEntity[];
    expect(decks.some((d) => d.id === deckId && d.name === 'Modern deck')).toBe(
      true,
    );
  });

  it('rejects creating a deck with an empty name', async () => {
    await request(app.getHttpServer())
      .post('/decks')
      .set('Authorization', `Bearer ${ownerToken}`)
      .send({ name: '' })
      .expect(400);
  });

  it('renames a deck for its owner, but 404s for a non-owner', async () => {
    const deckId = await createDeck(ownerToken, 'Original name');

    await request(app.getHttpServer())
      .patch(`/decks/${deckId}`)
      .set('Authorization', `Bearer ${otherOwnerToken}`)
      .send({ name: 'Hijacked name' })
      .expect(404);

    const res = await request(app.getHttpServer())
      .patch(`/decks/${deckId}`)
      .set('Authorization', `Bearer ${ownerToken}`)
      .send({ name: 'Renamed' })
      .expect(200);
    expect((res.body as DeckEntity).name).toBe('Renamed');
  });

  it('moves a card into a deck via PATCH /cards/:id, and back to Unsorted with deckId: null', async () => {
    const deckId = await createDeck(ownerToken, 'Commander binder');
    const cardId = await createCard(ownerToken, 'K Test Card (move)');

    const moved = await request(app.getHttpServer())
      .patch(`/cards/${cardId}`)
      .set('Authorization', `Bearer ${ownerToken}`)
      .send({ deckId })
      .expect(200);
    expect((moved.body as CardEntity).deckId).toBe(deckId);

    const unsorted = await request(app.getHttpServer())
      .patch(`/cards/${cardId}`)
      .set('Authorization', `Bearer ${ownerToken}`)
      .send({ deckId: null })
      .expect(200);
    expect((unsorted.body as CardEntity).deckId).toBeNull();
  });

  it('rejects moving a card into a deck owned by someone else', async () => {
    const otherDeckId = await createDeck(otherOwnerToken, "Other owner's deck");
    const cardId = await createCard(
      ownerToken,
      'K Test Card (cross-owner move)',
    );

    await request(app.getHttpServer())
      .patch(`/cards/${cardId}`)
      .set('Authorization', `Bearer ${ownerToken}`)
      .send({ deckId: otherDeckId })
      .expect(404);
  });

  it('filters GET /cards by deckId, and by the "unsorted" sentinel', async () => {
    const deckId = await createDeck(ownerToken, 'Filter test deck');
    const inDeckCardId = await createCard(ownerToken, 'K Filter — in deck');
    const unsortedCardId = await createCard(ownerToken, 'K Filter — unsorted');
    await request(app.getHttpServer())
      .patch(`/cards/${inDeckCardId}`)
      .set('Authorization', `Bearer ${ownerToken}`)
      .send({ deckId })
      .expect(200);

    const deckScoped = await request(app.getHttpServer())
      .get('/cards')
      .query({ ownerId, deckId })
      .expect(200);
    const deckScopedIds = (deckScoped.body as CardEntity[]).map((c) => c.id);
    expect(deckScopedIds).toContain(inDeckCardId);
    expect(deckScopedIds).not.toContain(unsortedCardId);

    const unsortedScoped = await request(app.getHttpServer())
      .get('/cards')
      .query({ ownerId, deckId: 'unsorted' })
      .expect(200);
    const unsortedScopedIds = (unsortedScoped.body as CardEntity[]).map(
      (c) => c.id,
    );
    expect(unsortedScopedIds).toContain(unsortedCardId);
    expect(unsortedScopedIds).not.toContain(inDeckCardId);
  });

  it('deleting a non-empty deck un-assigns its cards back to Unsorted rather than deleting them', async () => {
    const deckId = await createDeck(ownerToken, 'Deck to delete');
    const cardId = await createCard(
      ownerToken,
      'K Test Card (survives deck deletion)',
    );
    await request(app.getHttpServer())
      .patch(`/cards/${cardId}`)
      .set('Authorization', `Bearer ${ownerToken}`)
      .send({ deckId })
      .expect(200);

    await request(app.getHttpServer())
      .delete(`/decks/${deckId}`)
      .set('Authorization', `Bearer ${ownerToken}`)
      .expect(204);
    deckIds.splice(deckIds.indexOf(deckId), 1); // already gone — afterAll's deleteMany would no-op on it anyway, but keep the list honest

    const card = await request(app.getHttpServer())
      .get(`/cards/${cardId}`)
      .expect(200);
    expect((card.body as CardEntity).deckId).toBeNull();

    // The deck itself really is gone, not just emptied.
    await request(app.getHttpServer())
      .patch(`/decks/${deckId}`)
      .set('Authorization', `Bearer ${ownerToken}`)
      .send({ name: 'should 404' })
      .expect(404);
  });

  it('rejects deleting a deck owned by someone else', async () => {
    const deckId = await createDeck(
      otherOwnerToken,
      "Other owner's deck to delete",
    );

    await request(app.getHttpServer())
      .delete(`/decks/${deckId}`)
      .set('Authorization', `Bearer ${ownerToken}`)
      .expect(404);
  });
});
