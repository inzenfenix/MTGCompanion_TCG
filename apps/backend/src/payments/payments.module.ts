import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { AppConfig } from '../config/configuration';
import {
  PAYMENT_PROVIDERS,
  type PaymentProvider,
} from './payment-provider.interface';
import { NoopPaymentProvider } from './providers/noop-payment.provider';
import { CashPaymentProvider } from './providers/cash-payment.provider';
import { MercadoPagoProvider } from './providers/mercadopago-payment.provider';

// Webhook route lives in TransactionsModule (POST /payments/webhook,
// transactions/presentation/transactions.controller.ts) — it needs
// TransactionRepository to record the status update, and TransactionsModule
// already imports this one, so putting the controller there avoids a
// circular module import. The route path is unaffected by which module
// declares it.
@Module({
  providers: [
    NoopPaymentProvider,
    CashPaymentProvider,
    MercadoPagoProvider,
    {
      provide: PAYMENT_PROVIDERS,
      useFactory: (
        config: ConfigService<AppConfig, true>,
        noop: NoopPaymentProvider,
        cash: CashPaymentProvider,
        mercadopago: MercadoPagoProvider,
      ): Record<'MERCADOPAGO' | 'CASH', PaymentProvider> => ({
        // Falls back to Noop when unconfigured — today's behavior,
        // unchanged, rather than failing every MercadoPago-method checkout.
        MERCADOPAGO: config.get('payments', { infer: true }).mercadopago
          .accessToken
          ? mercadopago
          : noop,
        CASH: cash,
      }),
      inject: [
        ConfigService,
        NoopPaymentProvider,
        CashPaymentProvider,
        MercadoPagoProvider,
      ],
    },
  ],
  exports: [PAYMENT_PROVIDERS],
})
export class PaymentsModule {}
