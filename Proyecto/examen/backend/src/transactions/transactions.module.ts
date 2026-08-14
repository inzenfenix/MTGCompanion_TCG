import { Module } from '@nestjs/common';
import { CardsModule } from '../cards/cards.module';
import { PaymentsModule } from '../payments/payments.module';
import { TRANSACTION_REPOSITORY } from './domain/transaction.repository';
import { PrismaTransactionRepository } from './infrastructure/prisma-transaction.repository';
import { TransactionsService } from './application/transactions.service';
import { TransactionsController } from './presentation/transactions.controller';

@Module({
  imports: [CardsModule, PaymentsModule],
  controllers: [TransactionsController],
  providers: [
    { provide: TRANSACTION_REPOSITORY, useClass: PrismaTransactionRepository },
    TransactionsService,
  ],
  exports: [TransactionsService],
})
export class TransactionsModule {}
