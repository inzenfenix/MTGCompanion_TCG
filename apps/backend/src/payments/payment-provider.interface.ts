export type PaymentMethod = 'MERCADOPAGO' | 'CASH';

export interface CreatePaymentInput {
  transactionId: string;
  amount: number;
  description: string;
}

export interface CreatePaymentResult {
  /** Opaque reference from the provider (e.g. MercadoPago preference/payment id). Stored as Transaction.paymentRef. */
  paymentRef: string;
  /** URL the buyer is sent to in order to pay, when the provider is a redirect-based checkout. */
  redirectUrl?: string;
  /**
   * True when the provider already settled the payment synchronously
   * (e.g. cash exchanged in person) — TransactionsService marks the
   * transaction PAID immediately instead of waiting on a webhook. Generic
   * signal so TransactionsService never has to branch on which concrete
   * provider ran.
   */
  paidImmediately?: boolean;
}

/** Raw HTTP headers/query a webhook handler needs — a provider picks out whatever it needs. */
export interface WebhookContext {
  headers: Record<string, string | string[] | undefined>;
  query: Record<string, string | string[] | undefined>;
}

/**
 * Everything transaction-status logic needs from a payment provider.
 * Implementations today: NoopPaymentProvider (placeholder), CashPaymentProvider
 * (settles synchronously), MercadoPagoProvider (real Checkout Pro, async via
 * webhook). Selected per-transaction by PaymentMethod — see PAYMENT_PROVIDERS
 * below, injected as a Record<PaymentMethod, PaymentProvider>.
 */
export interface PaymentProvider {
  createPayment(input: CreatePaymentInput): Promise<CreatePaymentResult>;

  /**
   * Verifies + parses a provider webhook notification into a status update.
   * Returns our own Transaction.id (not the provider's payment id — for
   * MercadoPago that's `external_reference`, set to the transaction id at
   * createPayment() time, so TransactionsService never has to look anything
   * up by a provider-specific reference). Throws on invalid signature.
   */
  handleWebhook(
    payload: unknown,
    context: WebhookContext,
  ): Promise<{ transactionId: string; paid: boolean }>;
}

/** Injected as Record<PaymentMethod, PaymentProvider> — see payments.module.ts. */
export const PAYMENT_PROVIDERS = Symbol('PAYMENT_PROVIDERS');
