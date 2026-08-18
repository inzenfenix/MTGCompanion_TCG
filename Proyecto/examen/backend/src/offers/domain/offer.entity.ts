/**
 * One row per bid in a card's live auction (ROADMAP.md J12). Never updated
 * or deleted — the "current" offer is always just the latest row for a
 * given cardId, ordered by createdAt.
 */
export interface OfferEntity {
  id: string;
  cardId: string;
  bidderId: string;
  amount: number;
  createdAt: Date;
}
