import { Injectable, Logger, NotImplementedException } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import type {
  CreatePaymentInput,
  CreatePaymentResult,
  PaymentProvider,
} from '../payment-provider.interface';

/**
 * "Efectivo" — in-person cash. There is no external rail to call, so the
 * transaction stays PENDING after creation (paidImmediately: false) until
 * the seller — who actually receives the physical cash — explicitly
 * confirms via POST /transactions/:id/confirm-cash-received
 * (TransactionsService.confirmCashReceived(), ROADMAP.md J6). Earlier this
 * settled PAID immediately on the buyer's own say-so; that was replaced
 * because a malicious buyer could claim a cash payment that never happened
 * with no seller-side check at all, and because card ownership now DOES
 * transfer on PAID (J9) — auto-settling on a one-sided claim was fine when
 * "PAID" was cosmetic, not once it moves a real card. Still doubles as the
 * no-credentials payment path for testing/demos, just with an extra
 * explicit confirm step.
 */
@Injectable()
export class CashPaymentProvider implements PaymentProvider {
  private readonly logger = new Logger(CashPaymentProvider.name);

  createPayment(input: CreatePaymentInput): Promise<CreatePaymentResult> {
    this.logger.log(
      `CashPaymentProvider.createPayment(${input.transactionId}) — pending seller confirmation, no external rail`,
    );
    return Promise.resolve({
      paymentRef: `cash_${randomUUID()}`,
      paidImmediately: false,
    });
  }

  handleWebhook(): Promise<{ transactionId: string; paid: boolean }> {
    throw new NotImplementedException(
      'CashPaymentProvider has no webhook — cash settles synchronously at creation time',
    );
  }
}
