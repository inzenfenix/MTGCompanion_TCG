import { Module } from '@nestjs/common';
import { CardsModule } from '../cards/cards.module';
import { PaymentsModule } from '../payments/payments.module';
import { OffersModule } from '../offers/offers.module';
import { UsersModule } from '../users/users.module';
import { TRANSACTION_REPOSITORY } from './domain/transaction.repository';
import { PrismaTransactionRepository } from './infrastructure/prisma-transaction.repository';
import { TransactionsService } from './application/transactions.service';
import {
  TransactionsController,
  PaymentsWebhookController,
} from './presentation/transactions.controller';

@Module({
  imports: [CardsModule, PaymentsModule, OffersModule, UsersModule],
  controllers: [TransactionsController, PaymentsWebhookController],
  providers: [
    { provide: TRANSACTION_REPOSITORY, useClass: PrismaTransactionRepository },
    TransactionsService,
  ],
  exports: [TransactionsService],
})
export class TransactionsModule {}
