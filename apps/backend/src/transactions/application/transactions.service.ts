import {
  BadRequestException,
  ForbiddenException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import type { PaymentMethod } from '../../../generated/prisma';
import { CardsService } from '../../cards/application/cards.service';
import { OffersService } from '../../offers/application/offers.service';
import { UsersService } from '../../users/application/users.service';
import { CouponsService } from '../../coupons/application/coupons.service';
import {
  PAYMENT_PROVIDERS,
  type PaymentProvider,
  type WebhookContext,
} from '../../payments/payment-provider.interface';
import {
  TRANSACTION_REPOSITORY,
  type TransactionRepository,
} from '../domain/transaction.repository';
import type { TransactionEntity } from '../domain/transaction.entity';
import { computeIvaBreakdown, IVA_RATE } from '../domain/iva';
import {
  TRANSACTION_PAID_EVENT,
  TransactionPaidEvent,
} from '../../common/events/transaction-paid.event';
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
    private readonly offers: OffersService,
    private readonly users: UsersService,
    private readonly coupons: CouponsService,
    private readonly events: EventEmitter2,
  ) {}

  async create(buyerId: string, dto: CreateTransactionDto) {
    // Card + seller come from the card record, not from the request body —
    // the buyer shouldn't get to name their own price or seller.
    const card = await this.cards.findOne(dto.cardId);

    if (card.ownerId === buyerId) {
      throw new BadRequestException('Cannot buy your own card');
    }

    // ROADMAP.md J9 — a card with a resolved auction (wonOfferId set, see
    // OffersService.resolveIfExpired) is priced off the winning offer, not
    // the flat asking price, and only the winning bidder may complete the
    // purchase. Consumed here (not deferred to PAID) so a second buyer
    // can't also try to complete the same won auction concurrently.
    let amount = card.guessedPrice;
    if (card.wonOfferId) {
      const winningOffer = await this.offers.findById(card.wonOfferId);
      if (!winningOffer) {
        // Shouldn't happen — wonOfferId only ever points at a real Offer
        // row — but stay safe rather than silently mis-price a purchase.
        throw new NotFoundException('Winning offer not found');
      }
      if (winningOffer.bidderId !== buyerId) {
        throw new BadRequestException(
          'Only the winning bidder can complete this purchase',
        );
      }
      amount = winningOffer.amount;
      await this.cards.setAuctionState(card.id, {
        closesAt: null,
        wonOfferId: null,
      });
    }

    // ROADMAP.md L1/L3 — a coupon discounts amount right here, before the
    // Transaction row is created, so amount already reflects it everywhere
    // downstream (payment provider charge, IVA receipt breakdown) — no
    // separate "discount line item" concept needed. validateAndPrice()
    // checks ownership/redeemed/expired but does NOT mark it redeemed yet;
    // that happens below once a real transactionId exists to redeem
    // against (mirrors this method's own existing non-atomic style, e.g.
    // markPaid()'s sequential card-transfer-then-event-emit).
    if (dto.couponId) {
      ({ discountedAmount: amount } = await this.coupons.validateAndPrice(
        dto.couponId,
        buyerId,
        amount,
      ));
    }

    const method: PaymentMethod = dto.paymentMethod ?? 'MERCADOPAGO';
    const provider = this.paymentProviders[method];

    const transaction = await this.transactions.create({
      cardId: card.id,
      buyerId,
      sellerId: card.ownerId,
      amount,
      paymentMethod: method,
    });

    if (dto.couponId) {
      await this.coupons.markRedeemed(dto.couponId, transaction.id);
    }

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

      // paidImmediately is the generic signal a provider can settle
      // synchronously at creation time (no concrete provider does today —
      // CashPaymentProvider moved off this path per J6 — but the mechanism
      // stays for whichever future one does) so this never has to branch on
      // which concrete provider ran.
      const settled = payment.paidImmediately
        ? await this.markPaid(withPayment.id)
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
    return paid
      ? this.markPaid(transactionId)
      : this.transactions.updateStatus(transactionId, 'FAILED');
  }

  /**
   * ROADMAP.md J6/J7 — the seller-only cash confirmation step. Cash no
   * longer auto-settles PAID at creation (see CashPaymentProvider) since a
   * completed purchase now actually moves the card (J9) — a one-sided
   * buyer claim isn't enough for that.
   */
  async confirmCashReceived(transactionId: string, currentUserId: string) {
    const transaction = await this.findOne(transactionId);
    if (transaction.sellerId !== currentUserId) {
      throw new ForbiddenException(
        'Only the seller can confirm a cash payment',
      );
    }
    if (transaction.paymentMethod !== 'CASH') {
      throw new BadRequestException(
        'Only CASH transactions are confirmed this way',
      );
    }
    if (transaction.status !== 'PENDING') {
      throw new BadRequestException(
        `Transaction is ${transaction.status}, not PENDING`,
      );
    }
    return this.markPaid(transactionId);
  }

  /**
   * The single place a transaction actually becomes PAID (ROADMAP.md
   * J6/J8/J9's shared trigger point) — called from the MercadoPago webhook,
   * confirmCashReceived, and create()'s synchronous-settlement branch.
   * Transfers card ownership to the buyer and emits transaction.paid for
   * NotificationsModule's receipt-email listener, so neither concern has to
   * be duplicated at each call site.
   */
  private async markPaid(transactionId: string): Promise<TransactionEntity> {
    const updated = await this.transactions.updateStatus(transactionId, 'PAID');
    const [card, buyer, seller] = await Promise.all([
      this.cards.findOne(updated.cardId),
      this.users.findById(updated.buyerId),
      this.users.findById(updated.sellerId),
    ]);

    await this.cards.transferOwnership(updated.cardId, updated.buyerId);

    if (buyer && seller) {
      const { net, iva, total } = computeIvaBreakdown(updated.amount);
      this.events.emit(
        TRANSACTION_PAID_EVENT,
        new TransactionPaidEvent(
          updated.id,
          buyer.email,
          seller.email,
          card.title,
          updated.paymentMethod,
          net,
          iva,
          total,
        ),
      );
    } else {
      // Shouldn't happen — buyerId/sellerId always point at real users —
      // but a missing receipt email is far less bad than crashing a
      // payment confirmation over it.
      this.logger.warn(
        `markPaid(${transactionId}): buyer or seller not found, skipping receipt email`,
      );
    }

    return updated;
  }
}
