import {
  BadRequestException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { CardsService } from '../../cards/application/cards.service';
import {
  PAYMENT_PROVIDER,
  type PaymentProvider,
} from '../../payments/payment-provider.interface';
import {
  TRANSACTION_REPOSITORY,
  type TransactionRepository,
} from '../domain/transaction.repository';
import type { CreateTransactionDto } from '../presentation/dto/create-transaction.dto';

@Injectable()
export class TransactionsService {
  private readonly logger = new Logger(TransactionsService.name);

  constructor(
    @Inject(TRANSACTION_REPOSITORY)
    private readonly transactions: TransactionRepository,
    @Inject(PAYMENT_PROVIDER) private readonly paymentProvider: PaymentProvider,
    private readonly cards: CardsService,
  ) {}

  async create(dto: CreateTransactionDto) {
    // Card + seller come from the card record, not from the request body —
    // the buyer shouldn't get to name their own price or seller.
    const card = await this.cards.findOne(dto.cardId);

    if (card.ownerId === dto.buyerId) {
      throw new BadRequestException('Cannot buy your own card');
    }

    const transaction = await this.transactions.create({
      cardId: card.id,
      buyerId: dto.buyerId,
      sellerId: card.ownerId,
      amount: card.guessedPrice,
    });

    // NoopPaymentProvider today — see payments/providers/noop-payment.provider.ts.
    // Failure here shouldn't lose the transaction record; it just stays
    // PENDING with no paymentRef until retried.
    try {
      const payment = await this.paymentProvider.createPayment({
        transactionId: transaction.id,
        amount: transaction.amount,
        description: `${card.title} (${card.condition})`,
      });
      // Labels the record with whichever provider actually ran — 'NoopPaymentProvider'
      // today, 'MercadoPagoProvider' once that's wired in — rather than hardcoding a name.
      return this.transactions.attachPayment(
        transaction.id,
        this.paymentProvider.constructor.name,
        payment.paymentRef,
      );
    } catch (err) {
      this.logger.warn(
        `createPayment failed for transaction ${transaction.id}: ${(err as Error).message}`,
      );
      return transaction;
    }
  }

  async findOne(id: string) {
    const transaction = await this.transactions.findById(id);
    if (!transaction) throw new NotFoundException('Transaction not found');
    return transaction;
  }

  findForUser(userId: string) {
    return this.transactions.findForUser(userId);
  }
}
