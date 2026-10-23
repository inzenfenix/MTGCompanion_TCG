import type { PublicOfferView } from '../../offers/domain/public-offer';

export const OFFER_PLACED_EVENT = 'offer.placed';

/**
 * ROADMAP.md J13 — decouples "a new offer landed" (OffersService) from
 * "broadcast it over WebSockets" (OffersGateway), same event-emitter split
 * TransactionPaidEvent already established for J8. Carries the full new
 * auction window (closesAt) so every connected client's countdown resets
 * off the same server-authoritative value, never a client-computed one.
 * The offer is the public, pseudonymized view (no bidder id, ROADMAP.md
 * O14) — this goes out to every socket in the card's room.
 */
export class OfferPlacedEvent {
  constructor(
    public readonly cardId: string,
    public readonly offer: PublicOfferView,
    public readonly closesAt: Date,
  ) {}
}
