import type { CardCondition } from '../../../generated/prisma';
import type { CardEntity, CardPhotoEntity } from './card.entity';

export interface CreateCardData {
  ownerId: string;
  title: string;
  description?: string;
  guessedPrice: number;
  condition?: CardCondition;
  scryfallId?: string;
  setName?: string;
  rarity?: string;
  oracleText?: string;
}

export type UpdateCardData = Partial<Omit<CreateCardData, 'ownerId'>>;

/**
 * Port for card persistence. CardsService (application layer) only knows
 * this interface — PrismaCardRepository is the sole implementation today,
 * bound in cards.module.ts, and is the only place that imports Prisma.
 */
export interface CardRepository {
  create(data: CreateCardData): Promise<CardEntity>;
  findAllByOwner(ownerId: string): Promise<CardEntity[]>;
  findById(id: string): Promise<CardEntity | null>;
  update(id: string, data: UpdateCardData): Promise<CardEntity>;
  delete(id: string): Promise<void>;

  addPhoto(
    cardId: string,
    storageKey: string,
    isPrimary: boolean,
  ): Promise<CardPhotoEntity>;
  clearPrimaryPhoto(cardId: string): Promise<void>;
  findPhotoById(photoId: string): Promise<CardPhotoEntity | null>;
}

export const CARD_REPOSITORY = Symbol('CARD_REPOSITORY');
