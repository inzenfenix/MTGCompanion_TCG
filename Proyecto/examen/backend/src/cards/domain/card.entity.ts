import type { CardCondition } from '../../../generated/prisma';

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
  scryfallId: string | null;
  setName: string | null;
  rarity: string | null;
  oracleText: string | null;
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
