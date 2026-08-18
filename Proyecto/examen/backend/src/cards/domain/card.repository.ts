import type { CardCondition, CardOrigin } from '../../../generated/prisma';
import type {
  CardEntity,
  CardListingEntity,
  CardPhotoEntity,
} from './card.entity';

export interface CreateCardData {
  ownerId: string;
  title: string;
  description?: string;
  guessedPrice: number;
  condition?: CardCondition;
  /** Defaults to VAULT at the Prisma schema level when omitted. */
  origin?: CardOrigin;
  scryfallId?: string;
  setName?: string;
  rarity?: string;
  oracleText?: string;
}

export type UpdateCardData = Partial<Omit<CreateCardData, 'ownerId'>>;

/** Bazaar search params (E6) — at least one of `q`/`scryfallId` is required, enforced in CardsService. */
export interface SearchListingsParams {
  q?: string;
  scryfallId?: string;
  excludeOwnerId?: string;
  limit: number;
}

/** Auction state fields only — deliberately not part of UpdateCardData, so a
 * raw PATCH /cards/:id can never touch bidding state; only OffersService
 * (via CardsService.setAuctionState) writes these. */
export interface AuctionStateUpdate {
  closesAt: Date | null;
  wonOfferId: string | null;
}

/**
 * Port for card persistence. CardsService (application layer) only knows
 * this interface — PrismaCardRepository is the sole implementation today,
 * bound in cards.module.ts, and is the only place that imports Prisma.
 */
export interface CardRepository {
  create(data: CreateCardData): Promise<CardEntity>;
  /** origin omitted = every card regardless of origin; pass 'VAULT' for Tab3.tsx's collection view (J3). */
  findAllByOwner(ownerId: string, origin?: CardOrigin): Promise<CardEntity[]>;
  findById(id: string): Promise<CardEntity | null>;
  update(id: string, data: UpdateCardData): Promise<CardEntity>;
  updateAuctionState(id: string, data: AuctionStateUpdate): Promise<CardEntity>;
  /** ROADMAP.md J9 — moves a card to its buyer once a Transaction reaches PAID. Not part of UpdateCardData: a raw PATCH must never reassign ownership. */
  transferOwnership(id: string, newOwnerId: string): Promise<CardEntity>;
  delete(id: string): Promise<void>;

  /** Global (not owner-scoped) search across every listed card, for the Bazaar. */
  searchListings(params: SearchListingsParams): Promise<CardListingEntity[]>;

  addPhoto(
    cardId: string,
    storageKey: string,
    isPrimary: boolean,
  ): Promise<CardPhotoEntity>;
  clearPrimaryPhoto(cardId: string): Promise<void>;
  findPhotoById(photoId: string): Promise<CardPhotoEntity | null>;
}

export const CARD_REPOSITORY = Symbol('CARD_REPOSITORY');
