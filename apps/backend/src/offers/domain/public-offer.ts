/**
 * What anyone watching an auction gets to see about a bid (ROADMAP.md O14,
 * docs/security/ACTIVIDAD_4.md §2). The auction state is public — anyone
 * can open a listing — so it used to hand out every bidder's raw user id,
 * which is the same id GET /users/:id, listings (?ownerId=) and decks
 * (?ownerId=) are keyed by: enough to follow one person across every
 * auction they bid in and look up their profile and collection.
 *
 * Now each bidder shows up as an alias pseudonymized per card
 * (PseudonymService, scope "bid:<cardId>"): within one auction you can still
 * tell "the same bidder raised again", across auctions the aliases don't
 * match. `mine` tells the logged-in viewer which bids are theirs (Buy.tsx's
 * "did I win") without anyone needing the raw id.
 */
export interface PublicOfferView {
  id: string;
  cardId: string;
  bidderAlias: string;
  amount: number;
  createdAt: Date;
  /** Only present when the request came with a valid session. */
  mine?: boolean;
}
