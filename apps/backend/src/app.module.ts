import { Module } from '@nestjs/common';
import { APP_FILTER } from '@nestjs/core';
import { ConfigModule } from '@nestjs/config';
import { EventEmitterModule } from '@nestjs/event-emitter';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import configuration from './config/configuration';
import { PrismaModule } from './prisma/prisma.module';
import { CryptoModule } from './common/crypto/crypto.module';
import { PrivacyModule } from './common/privacy/privacy.module';
import { AuditModule } from './common/audit/audit.module';
import { SafeExceptionFilter } from './common/filters/safe-exception.filter';
import { StorageModule } from './storage/storage.module';
import { NotificationsModule } from './notifications/notifications.module';
import { PaymentsModule } from './payments/payments.module';
import { UsersModule } from './users/users.module';
import { AuthModule } from './auth/auth.module';
import { CardsModule } from './cards/cards.module';
import { TransactionsModule } from './transactions/transactions.module';
import { CatalogModule } from './catalog/catalog.module';
import { OffersModule } from './offers/offers.module';
import { DecksModule } from './decks/decks.module';
import { CouponsModule } from './coupons/coupons.module';
import { AdminModule } from './admin/admin.module';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true, load: [configuration] }),
    EventEmitterModule.forRoot(),
    PrismaModule,
    CryptoModule,
    PrivacyModule,
    AuditModule,
    StorageModule,
    NotificationsModule,
    PaymentsModule,
    UsersModule,
    AuthModule,
    CardsModule,
    TransactionsModule,
    CatalogModule,
    OffersModule,
    DecksModule,
    CouponsModule,
    AdminModule,
  ],
  controllers: [AppController],
  providers: [
    AppService,
    // ROADMAP.md O14 — generic 500s, redacted logs; see the filter's header.
    { provide: APP_FILTER, useClass: SafeExceptionFilter },
  ],
})
export class AppModule {}
