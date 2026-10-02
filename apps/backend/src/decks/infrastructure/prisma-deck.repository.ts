import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import type { CreateDeckData, DeckRepository } from '../domain/deck.repository';
import type { DeckEntity } from '../domain/deck.entity';
import type { Deck } from '../../../generated/prisma';

@Injectable()
export class PrismaDeckRepository implements DeckRepository {
  constructor(private readonly prisma: PrismaService) {}

  async create(data: CreateDeckData): Promise<DeckEntity> {
    const deck = await this.prisma.deck.create({
      data: { name: data.name, owner: { connect: { id: data.ownerId } } },
    });
    return this.toEntity(deck);
  }

  async findAllForOwner(ownerId: string): Promise<DeckEntity[]> {
    const decks = await this.prisma.deck.findMany({
      where: { ownerId },
      orderBy: { createdAt: 'asc' },
    });
    return decks.map((deck) => this.toEntity(deck));
  }

  async findById(id: string): Promise<DeckEntity | null> {
    const deck = await this.prisma.deck.findUnique({ where: { id } });
    return deck ? this.toEntity(deck) : null;
  }

  async rename(id: string, name: string): Promise<DeckEntity> {
    const deck = await this.prisma.deck.update({
      where: { id },
      data: { name },
    });
    return this.toEntity(deck);
  }

  async delete(id: string): Promise<void> {
    // Cards pointing at this deck are un-assigned to Unsorted by the FK's
    // own `onDelete: SetNull` — no separate Card update needed here.
    await this.prisma.deck.delete({ where: { id } });
  }

  private toEntity(deck: Deck): DeckEntity {
    return { ...deck };
  }
}
