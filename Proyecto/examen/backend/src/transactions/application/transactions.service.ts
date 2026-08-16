import {
  BadRequestException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import type { PaymentMethod } from '../../../generated/prisma';
import { CardsService } from '../../cards/application/cards.service';
import {
  PAYMENT_PROVIDERS,
  type PaymentProvider,
  type WebhookContext,
} from '../../payments/payment-provider.interface';
import {
  TRANSACTION_REPOSITORY,
  type TransactionRepository,
} from '../domain/transaction.repository';
import { computeIvaBreakdown, IVA_RATE } from '../domain/iva';
import type { CreateTransactionDto } from '../presentation/dto/create-transaction.dto';

@Injectable()
export class TransactionsService {
  private readonly logger = new Logger(TransactionsService.name);

  constructor(
    @Inject(TRANSACTION_REPOSITORY)
    private readonly transactions: TransactionRepository,
    @Inject(PAYMENT_PROVIDERS)
    private readonly paymentProviders: Record<PaymentMethod, PaymentProvider>,
    private readonly cards: CardsService,
  ) {}

  async create(buyerId: string, dto: CreateTransactionDto) {
    // Card + seller come from the card record, not from the request body —
    // the buyer shouldn't get to name their own price or seller.
    const card = await this.cards.findOne(dto.cardId);

    if (card.ownerId === buyerId) {
      throw new BadRequestException('Cannot buy your own card');
    }

    const method: PaymentMethod = dto.paymentMethod ?? 'MERCADOPAGO';
    const provider = this.paymentProviders[method];

    const transaction = await this.transactions.create({
      cardId: card.id,
      buyerId,
      sellerId: card.ownerId,
      amount: card.guessedPrice,
      paymentMethod: method,
    });

    // Failure here shouldn't lose the transaction record; it just stays
    // PENDING with no paymentRef until retried.
    try {
      const payment = await provider.createPayment({
        transactionId: transaction.id,
        amount: transaction.amount,
        description: `${card.title} (${card.condition})`,
      });
      // Labels the record with whichever provider actually ran — 'NoopPaymentProvider'/
      // 'CashPaymentProvider'/'MercadoPagoProvider' — rather than hardcoding a name.
      const withPayment = await this.transactions.attachPayment(
        transaction.id,
        provider.constructor.name,
        payment.paymentRef,
      );

      // Cash (and any future in-person method) settles synchronously —
      // paidImmediately is the generic signal so this never has to branch
      // on which concrete provider ran.
      const settled = payment.paidImmediately
        ? await this.transactions.updateStatus(withPayment.id, 'PAID')
        : withPayment;

      // Surfaced once, at creation time only — not persisted. The frontend
      // redirects the buyer there for a MercadoPago (or future
      // redirect-based) checkout.
      return payment.redirectUrl
        ? { ...settled, checkoutUrl: payment.redirectUrl }
        : settled;
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

  /**
   * Internal itemized receipt showing the 19% IVA breakdown on the sale
   * amount (Chilean retail prices are IVA-inclusive, so amount is the
   * total and net/IVA are derived from it — see domain/iva.ts). This is
   * NOT a real SII-authorized "boleta electrónica" — Chile's electronic
   * invoicing system requires SII registration/certification this project
   * doesn't have — hence the explicit disclaimer field.
   */
  async getReceipt(id: string) {
    const transaction = await this.findOne(id);
    if (transaction.status !== 'PAID') {
      throw new BadRequestException(
        'Transaction not paid yet — no receipt to issue',
      );
    }
    const card = await this.cards.findOne(transaction.cardId);
    const { net, iva, total } = computeIvaBreakdown(transaction.amount);

    return {
      transactionId: transaction.id,
      issuedAt: transaction.updatedAt,
      item: card.title,
      paymentMethod: transaction.paymentMethod,
      ivaRate: IVA_RATE,
      net,
      iva,
      total,
      disclaimer:
        'Comprobante interno generado por MTG Companion — no constituye una boleta ' +
        'o factura electrónica autorizada por el SII.',
    };
  }

  /** POST /payments/webhook — see transactions.controller.ts for the route. */
  async handlePaymentWebhook(payload: unknown, context: WebhookContext) {
    const { transactionId, paid } =
      await this.paymentProviders.MERCADOPAGO.handleWebhook(payload, context);
    const transaction = await this.transactions.findById(transactionId);
    if (!transaction) {
      throw new NotFoundException(
        `Webhook referenced unknown transaction ${transactionId}`,
      );
    }
    return this.transactions.updateStatus(
      transactionId,
      paid ? 'PAID' : 'FAILED',
    );
  }
}
