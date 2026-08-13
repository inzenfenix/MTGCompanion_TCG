import { Module } from '@nestjs/common';
import { PAYMENT_PROVIDER } from './payment-provider.interface';
import { NoopPaymentProvider } from './providers/noop-payment.provider';

// Webhook route (POST /payments/webhook) is added once a real provider
// lands — a webhook that can only reach a NotImplementedException isn't
// worth exposing yet.
@Module({
  providers: [
    NoopPaymentProvider,
    { provide: PAYMENT_PROVIDER, useExisting: NoopPaymentProvider },
  ],
  exports: [PAYMENT_PROVIDER],
})
export class PaymentsModule {}
