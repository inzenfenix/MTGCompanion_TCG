import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import request from 'supertest';
import { App } from 'supertest/types';
import { AppModule } from './../../src/app.module';
import { PrismaService } from './../../src/prisma/prisma.service';
import type { LoginResult } from './../../src/auth/application/auth.service';
import type { UserResponseDto } from './../../src/users/presentation/dto/user-response.dto';

// Shared setup for the ROADMAP.md O14 suites (access-control,
// privacy-controls, db-controls) — same app wiring as main.ts.
export async function createApp(): Promise<INestApplication<App>> {
  const moduleFixture: TestingModule = await Test.createTestingModule({
    imports: [AppModule],
  }).compile();
  const app = moduleFixture.createNestApplication<INestApplication<App>>();
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
    }),
  );
  await app.init();
  return app;
}

export interface TestAccount {
  id: string;
  email: string;
  token: string;
}

export async function registerAndLogin(
  app: INestApplication<App>,
  email: string,
  displayName: string,
): Promise<TestAccount> {
  const password = 'o14-test-pass-123';
  const register = await request(app.getHttpServer())
    .post('/users/register')
    .send({ email, password, displayName, adultConfirmed: true })
    .expect(201);
  const login = await request(app.getHttpServer())
    .post('/auth/login')
    .send({ email, password })
    .expect(201);
  return {
    id: (register.body as UserResponseDto).id,
    email,
    token: (login.body as LoginResult).accessToken,
  };
}

/** FK order: transactions/coupons → cards → users (audit_logs are append-only and pseudonymized, so they stay). */
export async function cleanupUsers(prisma: PrismaService, userIds: string[]) {
  await prisma.coupon.deleteMany({
    where: { issuedToUserId: { in: userIds } },
  });
  await prisma.transaction.deleteMany({
    where: {
      OR: [{ buyerId: { in: userIds } }, { sellerId: { in: userIds } }],
    },
  });
  await prisma.offer.deleteMany({ where: { bidderId: { in: userIds } } });
  await prisma.card.deleteMany({ where: { ownerId: { in: userIds } } });
  await prisma.refreshToken.deleteMany({ where: { userId: { in: userIds } } });
  await prisma.user.deleteMany({ where: { id: { in: userIds } } });
}
