import { Module } from '@nestjs/common';
import { CONSENT_REPOSITORY } from './domain/consent.repository';
import { PrismaConsentRepository } from './infrastructure/prisma-consent.repository';
import { ConsentService } from './application/consent.service';
import { ConsentController } from './presentation/consent.controller';

// ROADMAP.md O15 — consent per purpose. Exported so the processes that
// depend on a consent (UsersModule's location, NotificationsModule's
// optional emails, the 2FA flow, erasure) ask ConsentService directly.
@Module({
  controllers: [ConsentController],
  providers: [
    { provide: CONSENT_REPOSITORY, useClass: PrismaConsentRepository },
    ConsentService,
  ],
  exports: [ConsentService],
})
export class ConsentModule {}
