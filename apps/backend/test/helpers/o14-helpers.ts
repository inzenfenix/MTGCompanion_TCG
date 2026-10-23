import { Test, TestingModule, TestingModuleBuilder } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import request from 'supertest';
import { App } from 'supertest/types';
import { AppModule } from './../../src/app.module';
import { PrismaService } from './../../src/prisma/prisma.service';
import type { LoginResult } from './../../src/auth/application/auth.service';
import type { UserResponseDto } from './../../src/users/presentation/dto/user-response.dto';
import {
  EMAIL_PROVIDER,
  type EmailProvider,
  type SendEmailInput,
} from './../../src/notifications/email-provider.interface';

// Shared setup for the ROADMAP.md O14 suites (access-control,
// privacy-controls, db-controls) — same app wiring as main.ts.
export async function createApp(
  // O15 suites swap EMAIL_PROVIDER for a recording fake.
  override: (b: TestingModuleBuilder) => TestingModuleBuilder = (b) => b,
): Promise<INestApplication<App>> {
  const moduleFixture: TestingModule = await override(
    Test.createTestingModule({ imports: [AppModule] }),
  ).compile();
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

export const TEST_PASSWORD = 'o14-test-pass-123';

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
  const password = TEST_PASSWORD;
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

/** POST /consents/me/:purpose with the purpose's current version (ROADMAP.md O15). */
export async function grantConsent(
  app: INestApplication<App>,
  token: string,
  purpose: string,
) {
  const purposes = await request(app.getHttpServer())
    .get('/consents/purposes')
    .expect(200);
  const def = (purposes.body as { code: string; version: string }[]).find(
    (p) => p.code === purpose,
  );
  return request(app.getHttpServer())
    .post(`/consents/me/${purpose}`)
    .set('Authorization', `Bearer ${token}`)
    .send({ version: def!.version })
    .expect(201);
}

/** Records emails instead of sending them (same pattern as payment-receipt-email.e2e-spec.ts). */
export class FakeEmailProvider implements EmailProvider {
  sent: SendEmailInput[] = [];
  send(input: SendEmailInput): Promise<void> {
    this.sent.push(input);
    return Promise.resolve();
  }
}

export const withFakeEmail =
  (fake: FakeEmailProvider) => (b: TestingModuleBuilder) =>
    b.overrideProvider(EMAIL_PROVIDER).useValue(fake);

/** POST /auth/step-up and return the token (ROADMAP.md O15). */
export async function stepUp(
  app: INestApplication<App>,
  token: string,
  password = TEST_PASSWORD,
): Promise<string> {
  const res = await request(app.getHttpServer())
    .post('/auth/step-up')
    .set('Authorization', `Bearer ${token}`)
    .send({ password })
    .expect(201);
  return (res.body as { stepUpToken: string }).stepUpToken;
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
