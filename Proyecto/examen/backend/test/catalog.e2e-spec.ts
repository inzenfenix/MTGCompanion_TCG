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
