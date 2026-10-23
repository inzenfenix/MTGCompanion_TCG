export const OFFER_RECEIVED_EVENT = 'offer.received';

/**
 * ROADMAP.md O15 — "someone bid on your card", for the seller's optional
 * email. Separate from OfferPlacedEvent (which is broadcast to every socket
 * watching the auction) because this one carries the seller's id, which
 * must never go out to other clients. The listener sends the email only if
 * the seller holds a current EMAIL_NOTIFICATIONS consent.
 */
export class OfferReceivedEvent {
  constructor(
    public readonly sellerId: string,
    public readonly cardTitle: string,
    public readonly amount: number,
  ) {}
}
