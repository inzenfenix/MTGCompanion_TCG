import { Injectable, Logger } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import {
  TRANSACTION_PAID_EVENT,
  TransactionPaidEvent,
} from '../../common/events/transaction-paid.event';
import { NotificationsService } from '../notifications.service';

/**
 * Decouples "a transaction got paid" from "email both parties a receipt" —
 * same shape as UserCreatedListener. A failed email never fails the
 * payment/confirmation request that triggered it.
 */
@Injectable()
export class TransactionPaidListener {
  private readonly logger = new Logger(TransactionPaidListener.name);

  constructor(private readonly notifications: NotificationsService) {}

  @OnEvent(TRANSACTION_PAID_EVENT)
  async handleTransactionPaid(event: TransactionPaidEvent): Promise<void> {
    const params = {
      cardTitle: event.cardTitle,
      paymentMethod: event.paymentMethod,
      net: event.net,
      iva: event.iva,
      total: event.total,
    };
    for (const to of [event.buyerEmail, event.sellerEmail]) {
      try {
        await this.notifications.sendPaymentReceiptEmail(to, params);
      } catch (err) {
        this.logger.error(
          `Failed to send payment receipt to ${to} for transaction ${event.transactionId}`,
          err instanceof Error ? err.stack : err,
        );
      }
    }
  }
}
