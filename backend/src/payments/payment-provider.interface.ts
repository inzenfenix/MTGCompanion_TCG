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
}

/**
 * Everything transaction-status logic needs from a payment provider.
 * Today only NoopPaymentProvider implements this — this interface is the
 * seam for plugging in MercadoPago later without touching TransactionsModule.
 */
export interface PaymentProvider {
  createPayment(input: CreatePaymentInput): Promise<CreatePaymentResult>;

  /** Verifies + parses a provider webhook payload into a status update. Throws on invalid signature. */
  handleWebhook(
    payload: unknown,
    signature?: string,
  ): Promise<{ paymentRef: string; paid: boolean }>;
}

export const PAYMENT_PROVIDER = Symbol('PAYMENT_PROVIDER');
