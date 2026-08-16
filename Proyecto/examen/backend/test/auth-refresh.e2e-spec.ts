import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import request from 'supertest';
import { App } from 'supertest/types';
import { AppModule } from './../src/app.module';
import { PrismaService } from './../src/prisma/prisma.service';
import type {
  LoginResult,
  RefreshResult,
} from './../src/auth/application/auth.service';

// ROADMAP.md G2 — e2e coverage for F3 (POST /auth/refresh). Mirrors the
// manual curl sequence F3's own ROADMAP row already verified by hand:
// login -> refresh -> reuse-of-rotated-token rejected -> garbage rejected
// -> missing field rejected. Formalizes it into a real test, doesn't
// re-verify anything new.
describe('Auth refresh (e2e)', () => {
  let app: INestApplication<App>;
  let prisma: PrismaService;
  const email = `g2-auth-refresh-${Date.now()}@example.com`;
  const password = 'correct-horse-battery-staple';

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication();
    // main.ts's bootstrap() applies this globally — replicated here since
    // createTestingModule() doesn't go through main.ts, and the DTO 400s
    // this suite asserts on depend on it (whitelist/forbidNonWhitelisted).
    app.useGlobalPipes(
      new ValidationPipe({
        whitelist: true,
        forbidNonWhitelisted: true,
        transform: true,
      }),
    );
    await app.init();
    prisma = app.get(PrismaService);

    await request(app.getHttpServer())
      .post('/users/register')
      .send({ email, password, displayName: 'G2 Auth Test' })
      .expect(201);
  });

  afterAll(async () => {
    // Clean up so re-running this suite against the same dev DB doesn't
    // accumulate throwaway rows — same reasoning CLAUDE.md rule 2 already
    // applies to destructive-vs-idempotent scripts, just for test data here.
    const user = await prisma.user.findUnique({ where: { email } });
    if (user) {
      await prisma.refreshToken.deleteMany({ where: { userId: user.id } });
      await prisma.user.delete({ where: { id: user.id } });
    }
    await app.close();
  });

  it('login returns an access+refresh token pair', async () => {
    const res = await request(app.getHttpServer())
      .post('/auth/login')
      .send({ email, password })
      .expect(201);
    const body = res.body as LoginResult;

    expect(body.accessToken).toEqual(expect.any(String));
    expect(body.refreshToken).toEqual(expect.any(String));
  });

  it('refresh exchanges a live token for a new pair, rotating (single-use) the old one', async () => {
    const login = await request(app.getHttpServer())
      .post('/auth/login')
      .send({ email, password })
      .expect(201);
    const firstRefreshToken = (login.body as LoginResult).refreshToken;

    const refreshed = await request(app.getHttpServer())
      .post('/auth/refresh')
      .send({ refreshToken: firstRefreshToken })
      .expect(201);
    const refreshedBody = refreshed.body as RefreshResult;

    expect(refreshedBody.accessToken).toEqual(expect.any(String));
    expect(refreshedBody.refreshToken).toEqual(expect.any(String));
    expect(refreshedBody.refreshToken).not.toBe(firstRefreshToken);

    // Reusing the now-rotated (deleted) token must fail, not silently succeed.
    await request(app.getHttpServer())
      .post('/auth/refresh')
      .send({ refreshToken: firstRefreshToken })
      .expect(401);

    // The fresh one from the rotation must actually work.
    await request(app.getHttpServer())
      .post('/auth/refresh')
      .send({ refreshToken: refreshedBody.refreshToken })
      .expect(201);
  });

  it('rejects a garbage refresh token with 401', () => {
    return request(app.getHttpServer())
      .post('/auth/refresh')
      .send({ refreshToken: 'not-a-real-token' })
      .expect(401);
  });

  it('rejects a missing refreshToken field with 400 (DTO validation)', () => {
    return request(app.getHttpServer())
      .post('/auth/refresh')
      .send({})
      .expect(400);
  });
});
