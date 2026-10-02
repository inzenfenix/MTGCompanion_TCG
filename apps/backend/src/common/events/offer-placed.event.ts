import type { OfferEntity } from '../../offers/domain/offer.entity';

export const OFFER_PLACED_EVENT = 'offer.placed';

/**
 * ROADMAP.md J13 — decouples "a new offer landed" (OffersService) from
 * "broadcast it over WebSockets" (OffersGateway), same event-emitter split
 * TransactionPaidEvent already established for J8. Carries the full new
 * auction window (closesAt) so every connected client's countdown resets
 * off the same server-authoritative value, never a client-computed one.
 */
export class OfferPlacedEvent {
  constructor(
    public readonly cardId: string,
    public readonly offer: OfferEntity,
    public readonly closesAt: Date,
  ) {}
}
