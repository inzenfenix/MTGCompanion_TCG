import { Injectable, Logger, NotImplementedException } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import type {
  CreatePaymentInput,
  CreatePaymentResult,
  PaymentProvider,
} from '../payment-provider.interface';

/**
 * "Efectivo" — in-person cash. There is no external rail to call: the buyer
 * and seller are physically together, so the app trusts the buyer's own
 * "I paid" action and settles the transaction PAID immediately
 * (paidImmediately: true — see TransactionsService.create()). This is a
 * weaker guarantee than MercadoPago's third-party-confirmed webhook (a
 * malicious buyer could claim a cash payment that never happened), but it's
 * the same trust boundary any in-person cash sale has, and card ownership
 * doesn't transfer on a paid transaction yet either (see ROADMAP.md E5's
 * already-flagged gap) — low stakes today. Doubles as the fast,
 * no-credentials payment path for testing/demos.
 */
@Injectable()
export class CashPaymentProvider implements PaymentProvider {
  private readonly logger = new Logger(CashPaymentProvider.name);

  createPayment(input: CreatePaymentInput): Promise<CreatePaymentResult> {
    this.logger.log(
      `CashPaymentProvider.createPayment(${input.transactionId}) — settling PAID immediately, no external rail`,
    );
    return Promise.resolve({
      paymentRef: `cash_${randomUUID()}`,
      paidImmediately: true,
    });
  }

  handleWebhook(): Promise<{ transactionId: string; paid: boolean }> {
    throw new NotImplementedException(
      'CashPaymentProvider has no webhook — cash settles synchronously at creation time',
    );
  }
}
