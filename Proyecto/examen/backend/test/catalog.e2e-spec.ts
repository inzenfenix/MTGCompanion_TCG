import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import request from 'supertest';
import { App } from 'supertest/types';
import { AppModule } from './../src/app.module';
import type { CatalogCardEntity } from './../src/catalog/domain/catalog-card.entity';

// ROADMAP.md G2 — e2e coverage for F6's GET /catalog/search. Read-only
// against the already-imported catalog_cards table (F6's own ROADMAP row
// confirmed 58,679/58,679 rows imported), no fixtures/cleanup needed —
// mirrors the real query F6 verified by hand ("Lightning Bolt").
describe('Catalog search (e2e)', () => {
  let app: INestApplication<App>;

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
  });

  afterAll(async () => {
    await app.close();
  });

  it('returns real multi-printing results for a known card name', async () => {
    const res = await request(app.getHttpServer())
      .get('/catalog/search')
      .query({ q: 'Lightning Bolt' })
      .expect(200);
    const cards = res.body as CatalogCardEntity[];

    expect(Array.isArray(cards)).toBe(true);
    expect(cards.length).toBeGreaterThan(0);
    for (const card of cards) {
      expect(card.name.toLowerCase()).toContain('lightning bolt');
    }
  });

  // ROADMAP.md I19/I21 — real on-device testing found the OCR-read name for
  // a real "Moonstone Eulogist" photo came back as "Moonstone Fuloyist"
  // (one word garbled). A plain `contains` search for that exact string can
  // never match anything real; the pg_trgm fuzzy fallback
  // (prisma-catalog.repository.ts) should still surface the real card.
  it('falls back to a fuzzy match when the exact/contains search finds nothing (a real OCR-misread name)', async () => {
    const res = await request(app.getHttpServer())
      .get('/catalog/search')
      .query({ q: 'Moonstone Fuloyist' })
      .expect(200);
    const cards = res.body as CatalogCardEntity[];

    expect(Array.isArray(cards)).toBe(true);
    expect(cards.some((c) => c.name === 'Moonstone Eulogist')).toBe(true);
  });

  // ROADMAP.md I19/I25 — the other half of the combined title+rules-text
  // identify flow: this is the ACTUAL raw tesseract.js read captured live
  // on a real device (adb logcat) for a real "Moonstone Eulogist" photo —
  // not a hand-typed paraphrase. A short paraphrase ("whenever a creature
  // dies, create a token") was tried first and does NOT surface this card
  // in the top 20 (MTG's own templating means many cards share that
  // generic phrasing) — verified live against the real deployed endpoint
  // before landing this test, not assumed. The real OCR read works because
  // it's long enough AND — same insight the ROADMAP write-up makes — MTG
  // cards frequently self-reference their own name in their own rules text
  // ("put a +1/+1 counter on Moonstone Eulogist"), which is exactly what
  // survived the OCR noise here.
  it('search-by-text finds the real card from a real (noisy) rules-text OCR read, via oracleText not name', async () => {
    const res = await request(app.getHttpServer())
      .get('/catalog/search-by-text')
      .query({
        q: 'Creature — Bat Warlock 8 Flying . Whenever a creature an opponent controls dies, you create a Blood token. (Its an artifact with 1, Discard a card, Sacrifice this artifact: Draw a card.) : Whenever you sacrifice an artifact, put a +1/41 counter on Moonstone Eulogist and you gain 1 life. 4/4',
      })
      .expect(200);
    const cards = res.body as CatalogCardEntity[];

    expect(Array.isArray(cards)).toBe(true);
    expect(cards[0]?.name).toBe('Moonstone Eulogist'); // ranks #1 on the real endpoint, not just "somewhere in the list"
  });

  it('search-by-text rejects a query shorter than its 10-char minimum with 400', () => {
    return request(app.getHttpServer())
      .get('/catalog/search-by-text')
      .query({ q: 'short' })
      .expect(400);
  });

  it('rejects a query shorter than the 2-char minimum with 400', () => {
    return request(app.getHttpServer())
      .get('/catalog/search')
      .query({ q: 'a' })
      .expect(400);
  });

  it('rejects a missing q param with 400', () => {
    return request(app.getHttpServer()).get('/catalog/search').expect(400);
  });

  it('clamps an oversized limit rather than erroring', async () => {
    const res = await request(app.getHttpServer())
      .get('/catalog/search')
      .query({ q: 'Island', limit: '9999' })
      .expect(200);
    const cards = res.body as CatalogCardEntity[];

    expect(cards.length).toBeLessThanOrEqual(50); // MAX_LIMIT in catalog.service.ts
  });
});
