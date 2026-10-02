import { Injectable, Logger, NotImplementedException } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import type {
  CreatePaymentInput,
  CreatePaymentResult,
  PaymentProvider,
} from '../payment-provider.interface';

/**
 * Placeholder so TransactionsModule has something to inject today.
 * createPayment() fabricates a local reference and marks nothing as paid —
 * it does NOT call any real payment rail. Swap the PAYMENT_PROVIDER binding
 * in payments.module.ts for a MercadoPagoProvider when that's ready; nothing
 * outside this module needs to change.
 */
@Injectable()
export class NoopPaymentProvider implements PaymentProvider {
  private readonly logger = new Logger(NoopPaymentProvider.name);

  createPayment(input: CreatePaymentInput): Promise<CreatePaymentResult> {
    this.logger.warn(
      `NoopPaymentProvider.createPayment(${input.transactionId}) — no real payment rail configured yet, transaction stays PENDING`,
    );
    return Promise.resolve({ paymentRef: `noop_${randomUUID()}` });
  }

  handleWebhook(): Promise<{ transactionId: string; paid: boolean }> {
    throw new NotImplementedException(
      'NoopPaymentProvider has no webhook — MercadoPago is not configured (MERCADOPAGO_ACCESS_TOKEN unset)',
    );
  }
}
