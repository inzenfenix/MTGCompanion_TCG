export const TRANSACTION_PAID_EVENT = 'transaction.paid';

/**
 * Carries everything NotificationsModule's listener needs to email both
 * parties a receipt (ROADMAP.md J8) without NotificationsModule having to
 * depend on TransactionsModule/CardsModule/UsersModule — same "carry the
 * needed fields in the event payload" pattern UserCreatedEvent already
 * established. net/iva/total are the SAME numbers TransactionsService
 * .getReceipt() computes (via domain/iva.ts) — not recomputed here.
 */
export class TransactionPaidEvent {
  constructor(
    public readonly transactionId: string,
    public readonly buyerEmail: string,
    public readonly sellerEmail: string,
    public readonly cardTitle: string,
    public readonly paymentMethod: string,
    public readonly net: number,
    public readonly iva: number,
    public readonly total: number,
  ) {}
}
