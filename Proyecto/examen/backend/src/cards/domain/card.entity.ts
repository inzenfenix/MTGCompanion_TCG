import type { CardCondition, CardOrigin } from '../../../generated/prisma';

export interface CardPhotoEntity {
  id: string;
  cardId: string;
  storageKey: string;
  isPrimary: boolean;
  createdAt: Date;
}

/**
 * Domain shape for a card. `guessedPrice` is a plain number here — Prisma's
 * Decimal type is a persistence detail that stays inside
 * infrastructure/prisma-card.repository.ts.
 */
export interface CardEntity {
  id: string;
  ownerId: string;
  title: string;
  description: string | null;
  guessedPrice: number;
  condition: CardCondition;
  /** VAULT (permanent collection) vs. SCAN_LISTING (scanned only to sell) — ROADMAP.md J1/J3. */
  origin: CardOrigin;
  scryfallId: string | null;
  setName: string | null;
  rarity: string | null;
  oracleText: string | null;
  /**
   * Auction state (ROADMAP.md J12). Both null = not currently up for
   * bidding, same as every card before this feature existed. closesAt is
   * pushed to now+5s on every new Offer; OffersService lazily resolves the
   * auction (no cron job) once a read finds now > closesAt, at which point
   * wonOfferId is set and closesAt is cleared. TransactionsService.create()
   * consumes wonOfferId and clears it back to null once the winning offer
   * is actually purchased, so a later re-auction starts clean.
   */
  closesAt: Date | null;
  wonOfferId: string | null;
  createdAt: Date;
  updatedAt: Date;
  photos: CardPhotoEntity[];
}

/**
 * A CardEntity plus enough about its owner to render a Bazaar search result
 * (E6 in ROADMAP.md) — who has it, and roughly how far away (if they've
 * ever shared a location, see UserSettings.shareLocation). Distance itself
 * is computed in CardsService, not here — this only carries the raw
 * lat/lng an owner last reported, kept nullable/honest rather than faked.
 */
export interface CardListingEntity extends CardEntity {
  ownerDisplayName: string;
  ownerLat: number | null;
  ownerLng: number | null;
}
