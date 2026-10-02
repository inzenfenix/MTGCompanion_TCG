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

// deckId isn't part of CreateCardData (a card is always created Unsorted,
// moved into a deck afterward — ROADMAP.md K) so it's added here rather
// than via the Omit<CreateCardData,...> derivation. `null` explicitly
// un-assigns back to Unsorted; `undefined` (the field simply absent from a
// PATCH body) leaves it untouched, same "absent vs. explicit null" contract
// every other optional PATCH field already has, just meaningful here since
// null is itself a valid target value.
export type UpdateCardData = Partial<Omit<CreateCardData, 'ownerId'>> & {
  deckId?: string | null;
};

/**
 * A real deck id, or the sentinel `'unsorted'` (not a value ever stored —
 * checked for literally, see PrismaCardRepository.findAllByOwner) meaning
 * "explicitly filter to deckId IS NULL". A bare `undefined` means "no deck
 * filter, every card regardless of deck". Can't be typed as a real
 * `string | 'unsorted'` union — the literal is already a subtype of
 * `string`, so it collapses to plain `string` — see
 * CardsController.findAll's own comment for the query-param contract.
 */
export type DeckFilter = string;

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
  /**
   * origin omitted = every card regardless of origin; pass 'VAULT' for
   * Tab3.tsx's collection view (J3). deckId omitted = every card
   * regardless of deck; pass a real deck id to scope to one deck, or
   * `'unsorted'` to scope to cards with no deck (ROADMAP.md K).
   */
  findAllByOwner(
    ownerId: string,
    origin?: CardOrigin,
    deckId?: DeckFilter,
  ): Promise<CardEntity[]>;
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
