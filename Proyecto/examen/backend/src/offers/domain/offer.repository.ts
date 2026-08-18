import type { OfferEntity } from './offer.entity';

export interface CreateOfferData {
  cardId: string;
  bidderId: string;
  amount: number;
}

export interface OfferRepository {
  create(data: CreateOfferData): Promise<OfferEntity>;
  /** Most recent offer for a card, or null if the card has never been bid on. */
  findLatestForCard(cardId: string): Promise<OfferEntity | null>;
  /** All offers for a card, newest first — the auction's full bid history. */
  findAllForCard(cardId: string): Promise<OfferEntity[]>;
  findById(id: string): Promise<OfferEntity | null>;
}

export const OFFER_REPOSITORY = Symbol('OFFER_REPOSITORY');
