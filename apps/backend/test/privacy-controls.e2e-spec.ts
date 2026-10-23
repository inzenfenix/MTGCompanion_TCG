import { INestApplication, Logger } from '@nestjs/common';
import request from 'supertest';
import { App } from 'supertest/types';
import { PrismaService } from './../src/prisma/prisma.service';
import { FieldEncryptionService } from './../src/common/crypto/field-encryption.service';
import { purgeExpiredData } from './../src/scripts/purge-expired-data';
import type { CardEntity } from './../src/cards/domain/card.entity';
import type { UserResponseDto } from './../src/users/presentation/dto/user-response.dto';
import {
  cleanupUsers,
  createApp,
  grantConsent,
  registerAndLogin,
  type TestAccount,
} from './helpers/o14-helpers';

interface PublicOffer {
  id: string;
  bidderAlias: string;
  bidderId?: string;
  mine?: boolean;
}

// ROADMAP.md O14 / docs/security/ACTIVIDAD_4.md §5 — minimization and
// pseudonymization checked against the real database, not just the API.
describe('Privacy controls — minimization, pseudonymization, logs (e2e)', () => {
  let app: INestApplication<App>;
  let prisma: PrismaService;
  let crypto: FieldEncryptionService;
  const stamp = Date.now();
  let seller: TestAccount;
  let bidder: TestAccount;
  const extraUserIds: string[] = [];
  const http = () => request(app.getHttpServer());
  const registration = (extra: object) => ({
    email: `pc-reg-${stamp}-${Math.random().toString(36).slice(2)}@example.com`,
    password: 'o14-test-pass-123',
    displayName: 'PC Player',
    adultConfirmed: true,
    ...extra,
  });

  beforeAll(async () => {
    app = await createApp();
    prisma = app.get(PrismaService);
    crypto = app.get(FieldEncryptionService);
    seller = await registerAndLogin(
      app,
      `pc-seller-${stamp}@example.com`,
      'PC Seller',
    );
    bidder = await registerAndLogin(
      app,
      `pc-bidder-${stamp}@example.com`,
      'PC Bidder',
    );
  });

  afterAll(async () => {
    await cleanupUsers(prisma, [seller.id, bidder.id, ...extraUserIds]);
    await app.close();
  });

  describe('registration stores only what is needed', () => {
    it('without the 18+ declaration → 400', async () => {
      await http()
        .post('/users/register')
        .send(registration({ adultConfirmed: undefined }))
        .expect(400);
    });

    it.each([
      ['a birth date', { birthDate: '2001-05-04' }],
      ['a phone number', { phone: '+56912345678' }],
      ['an address', { address: 'Av. Siempre Viva 742' }],
    ])(
      'extra personal data (%s) is refused, not silently stored → 400',
      async (_what, extra) => {
        await http()
          .post('/users/register')
          .send(registration(extra))
          .expect(400);
      },
    );

    it('a display name carrying an email or phone → 400', async () => {
      await http()
        .post('/users/register')
        .send(registration({ displayName: 'ana@example.com' }))
        .expect(400);
      await http()
        .post('/users/register')
        .send(registration({ displayName: 'Ana 9 8765 4321' }))
        .expect(400);
    });

    it('stores the moment of the 18+ declaration, never an age or birth date', async () => {
      const res = await http()
        .post('/users/register')
        .send(registration({}))
        .expect(201);
      const user = res.body as UserResponseDto;
      extraUserIds.push(user.id);
      expect(user.role).toBe('USER');
      const row = await prisma.user.findUnique({ where: { id: user.id } });
      expect(row?.adultConfirmedAt).toBeInstanceOf(Date);
      expect(Object.keys(row!)).not.toEqual(
        expect.arrayContaining(['birthDate']),
      );
    });

    it('logs never carry the full email (welcome-email failure path)', async () => {
      const lines: string[] = [];
      const spy = jest
        .spyOn(Logger.prototype, 'error')
        .mockImplementation(
          (...args: unknown[]) => void lines.push(args.map(String).join(' ')),
        );
      const body = registration({});
      const res = await http().post('/users/register').send(body).expect(201);
      extraUserIds.push((res.body as UserResponseDto).id);
      await new Promise((r) => setTimeout(r, 1500)); // listener is async; SMTP may be absent here
      spy.mockRestore();
      expect(lines.join('\n')).not.toContain(body.email);
    });
  });

  describe('location: coarsened, encrypted, expiring, revocable', () => {
    // O15: storing a location now needs an explicit consent first
    // (consent.e2e-spec.ts covers the 403 without it).
    beforeAll(async () => {
      await grantConsent(app, seller.token, 'LOCATION_DISTANCE');
      await grantConsent(app, bidder.token, 'LOCATION_DISTANCE');
    });

    it('is stored rounded to ~1 km and encrypted', async () => {
      await http()
        .patch('/users/me/location')
        .set('Authorization', `Bearer ${seller.token}`)
        .send({ lat: -33.4489123, lng: -70.6692655 })
        .expect(200);
      const settings = await prisma.userSettings.findUnique({
        where: { userId: seller.id },
      });
      expect(settings?.lastLat).toMatch(/^v1:/);
      expect(settings?.lastLat).not.toContain('33.44');
      expect(crypto.decryptNumber(settings?.lastLat)).toBe(-33.45);
      expect(crypto.decryptNumber(settings?.lastLng)).toBe(-70.67);
    });

    it('a fresh location yields a distance; one past the TTL is ignored by search', async () => {
      const title = `PC Listing ${stamp}`;
      await http()
        .post('/cards')
        .set('Authorization', `Bearer ${seller.token}`)
        .send({ title, guessedPrice: 5 })
        .expect(201);
      const search = () =>
        http()
          .get('/cards')
          .query({ q: title, lat: -33.45, lng: -70.6 })
          .expect(200);

      const fresh = (await search()).body as { distanceKm: number | null }[];
      expect(typeof fresh[0].distanceKm).toBe('number');

      await prisma.userSettings.update({
        where: { userId: seller.id },
        data: {
          locationUpdatedAt: new Date(Date.now() - 60 * 24 * 3600 * 1000),
        },
      });
      const stale = (await search()).body as { distanceKm: number | null }[];
      expect(stale[0].distanceKm).toBeNull();
    });

    it('the retention job erases stale locations and expired refresh tokens', async () => {
      await prisma.refreshToken.create({
        data: {
          tokenHash: `pc-expired-${stamp}`,
          userId: seller.id,
          expiresAt: new Date(Date.now() - 1000),
        },
      });
      const counts = await purgeExpiredData(prisma, 30);
      expect(counts.refreshTokens).toBeGreaterThanOrEqual(1);
      expect(counts.locations).toBeGreaterThanOrEqual(1);
      const settings = await prisma.userSettings.findUnique({
        where: { userId: seller.id },
      });
      expect(settings?.lastLat).toBeNull();
      expect(
        await prisma.refreshToken.findUnique({
          where: { tokenHash: `pc-expired-${stamp}` },
        }),
      ).toBeNull();
    });

    it('DELETE /users/me/location revokes it: flag off and coordinates erased', async () => {
      await http()
        .patch('/users/me/location')
        .set('Authorization', `Bearer ${bidder.token}`)
        .send({ lat: 10, lng: 10 })
        .expect(200);
      const res = await http()
        .delete('/users/me/location')
        .set('Authorization', `Bearer ${bidder.token}`)
        .expect(200);
      expect((res.body as UserResponseDto).settings.shareLocation).toBe(false);
      const settings = await prisma.userSettings.findUnique({
        where: { userId: bidder.id },
      });
      expect(settings).toMatchObject({
        shareLocation: false,
        lastLat: null,
        lastLng: null,
        locationUpdatedAt: null,
      });
    });
  });

  describe('listings and auctions', () => {
    it('a card description with contact data → 400', async () => {
      await http()
        .post('/cards')
        .set('Authorization', `Bearer ${seller.token}`)
        .send({
          title: 'PC Card',
          guessedPrice: 5,
          description: 'escríbeme al +56 9 1234 5678',
        })
        .expect(400);
    });

    it('public auction state shows per-card aliases, never bidder ids; `mine` only for the viewer', async () => {
      const newCard = async () =>
        (
          (
            await http()
              .post('/cards')
              .set('Authorization', `Bearer ${seller.token}`)
              .send({ title: 'PC Auction', guessedPrice: 5 })
              .expect(201)
          ).body as CardEntity
        ).id;
      const [cardA, cardB] = [await newCard(), await newCard()];
      for (const cardId of [cardA, cardB]) {
        await http()
          .post(`/cards/${cardId}/offers`)
          .set('Authorization', `Bearer ${bidder.token}`)
          .send({ amount: 6 })
          .expect(201);
      }
      const offersOf = async (cardId: string, token?: string) => {
        const req = http().get(`/cards/${cardId}/offers`);
        if (token) req.set('Authorization', `Bearer ${token}`);
        return ((await req.expect(200)).body as { offers: PublicOffer[] })
          .offers;
      };

      const [anon] = await offersOf(cardA);
      expect(anon.bidderAlias).toMatch(/^u_[0-9a-f]{16}$/);
      expect(anon.bidderId).toBeUndefined();
      expect(anon.mine).toBeUndefined();
      expect(JSON.stringify(anon)).not.toContain(bidder.id);

      expect((await offersOf(cardA, bidder.token))[0].mine).toBe(true);
      expect((await offersOf(cardA, seller.token))[0].mine).toBe(false);
      // Same bidder, different auction → unlinkable alias.
      expect((await offersOf(cardB))[0].bidderAlias).not.toBe(anon.bidderAlias);
    });
  });
});
