import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import request from 'supertest';
import { App } from 'supertest/types';
import { AppModule } from './../src/app.module';
import { PrismaService } from './../src/prisma/prisma.service';
import type { LoginResult } from './../src/auth/application/auth.service';
import type { UserResponseDto } from './../src/users/presentation/dto/user-response.dto';

// Issue #146 — GET /users/:id used to answer anyone (no auth) with the full
// user, email and settings included, while every Bazaar listing exposes its
// ownerId. It now requires a session and returns only id + displayName,
// which is all the app shows (seller on Buy, counterparty on a transaction).
describe('GET /users/:id public profile (e2e)', () => {
  let app: INestApplication<App>;
  let prisma: PrismaService;
  const stamp = Date.now();
  const seller = { email: `pp-seller-${stamp}@example.com`, password: 'seller-pass-123' };
  const viewer = { email: `pp-viewer-${stamp}@example.com`, password: 'viewer-pass-123' };
  let sellerId: string;
  let viewerId: string;
  let viewerToken: string;

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
    return {
      id: (register.body as UserResponseDto).id,
      accessToken: (login.body as LoginResult).accessToken,
    };
  }

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();
    app = moduleFixture.createNestApplication();
    app.useGlobalPipes(
      new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }),
    );
    await app.init();
    prisma = app.get(PrismaService);

    sellerId = (await registerAndLogin(seller, 'PP Seller')).id;
    const viewerAuth = await registerAndLogin(viewer, 'PP Viewer');
    viewerId = viewerAuth.id;
    viewerToken = viewerAuth.accessToken;
  });

  afterAll(async () => {
    await prisma.refreshToken.deleteMany({ where: { userId: { in: [sellerId, viewerId] } } });
    await prisma.user.deleteMany({ where: { id: { in: [sellerId, viewerId] } } });
    await app.close();
  });

  it('rejects anonymous requests', async () => {
    await request(app.getHttpServer()).get(`/users/${sellerId}`).expect(401);
  });

  it('returns only id and displayName to a logged-in user', async () => {
    const res = await request(app.getHttpServer())
      .get(`/users/${sellerId}`)
      .set('Authorization', `Bearer ${viewerToken}`)
      .expect(200);
    expect(res.body).toEqual({ id: sellerId, displayName: 'PP Seller' });
    expect(JSON.stringify(res.body)).not.toContain(seller.email);
  });

  it('404s an unknown id', async () => {
    await request(app.getHttpServer())
      .get('/users/00000000-0000-0000-0000-000000000000')
      .set('Authorization', `Bearer ${viewerToken}`)
      .expect(404);
  });
});
