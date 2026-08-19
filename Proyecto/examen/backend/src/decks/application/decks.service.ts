import { Inject, Injectable, NotFoundException } from '@nestjs/common';
import {
  DECK_REPOSITORY,
  type DeckRepository,
} from '../domain/deck.repository';

@Injectable()
export class DecksService {
  constructor(
    @Inject(DECK_REPOSITORY) private readonly decks: DeckRepository,
  ) {}

  create(ownerId: string, name: string) {
    return this.decks.create({ ownerId, name });
  }

  findAllForOwner(ownerId: string) {
    return this.decks.findAllForOwner(ownerId);
  }

  async findOne(id: string) {
    const deck = await this.decks.findById(id);
    if (!deck) throw new NotFoundException('Deck not found');
    return deck;
  }

  /**
   * Used by CardsService when a card is moved into a deck (`PATCH
   * /cards/:id` with `deckId` set) — verifies the target deck actually
   * belongs to the same owner before the move is allowed, same "same NotFoundException
   * whether missing or someone else's" pattern CardsService.findOwned()
   * already uses, so this doesn't leak whether a deck id exists to a
   * non-owner either.
   */
  async findOwned(id: string, currentUserId: string) {
    const deck = await this.findOne(id);
    if (deck.ownerId !== currentUserId) {
      throw new NotFoundException('Deck not found');
    }
    return deck;
  }

  async rename(id: string, currentUserId: string, name: string) {
    await this.findOwned(id, currentUserId);
    return this.decks.rename(id, name);
  }

  async remove(id: string, currentUserId: string) {
    await this.findOwned(id, currentUserId);
    await this.decks.delete(id);
  }
}
