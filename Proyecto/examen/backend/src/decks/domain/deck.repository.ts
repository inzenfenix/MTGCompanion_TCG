import type { DeckEntity } from './deck.entity';

export interface CreateDeckData {
  ownerId: string;
  name: string;
}

export interface DeckRepository {
  create(data: CreateDeckData): Promise<DeckEntity>;
  findAllForOwner(ownerId: string): Promise<DeckEntity[]>;
  findById(id: string): Promise<DeckEntity | null>;
  rename(id: string, name: string): Promise<DeckEntity>;
  /**
   * Deletes the Deck row only — cards that belonged to it are un-assigned
   * back to Unsorted by the database itself (`Card.deck`'s `onDelete:
   * SetNull` in schema.prisma), not by application code here. Nothing else
   * to do on this side.
   */
  delete(id: string): Promise<void>;
}

export const DECK_REPOSITORY = Symbol('DECK_REPOSITORY');
