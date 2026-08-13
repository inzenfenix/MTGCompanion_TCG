import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import type {
  CardRepository,
  CreateCardData,
  UpdateCardData,
} from '../domain/card.repository';
import type { CardEntity, CardPhotoEntity } from '../domain/card.entity';
import type { Card, CardPhoto } from '../../../generated/prisma';

type CardWithPhotos = Card & { photos: CardPhoto[] };

@Injectable()
export class PrismaCardRepository implements CardRepository {
  constructor(private readonly prisma: PrismaService) {}

  async create(data: CreateCardData): Promise<CardEntity> {
    const { ownerId, ...rest } = data;
    const card = await this.prisma.card.create({
      data: { ...rest, owner: { connect: { id: ownerId } } },
      include: { photos: true },
    });
    return this.toEntity(card);
  }

  async findAllByOwner(ownerId: string): Promise<CardEntity[]> {
    const cards = await this.prisma.card.findMany({
      where: { ownerId },
      include: { photos: true },
    });
    return cards.map((card) => this.toEntity(card));
  }

  async findById(id: string): Promise<CardEntity | null> {
    const card = await this.prisma.card.findUnique({
      where: { id },
      include: { photos: true },
    });
    return card ? this.toEntity(card) : null;
  }

  async update(id: string, data: UpdateCardData): Promise<CardEntity> {
    const card = await this.prisma.card.update({
      where: { id },
      data,
      include: { photos: true },
    });
    return this.toEntity(card);
  }

  async delete(id: string): Promise<void> {
    await this.prisma.card.delete({ where: { id } });
  }

  async addPhoto(
    cardId: string,
    storageKey: string,
    isPrimary: boolean,
  ): Promise<CardPhotoEntity> {
    return this.prisma.cardPhoto.create({
      data: { cardId, storageKey, isPrimary },
    });
  }

  async clearPrimaryPhoto(cardId: string): Promise<void> {
    await this.prisma.cardPhoto.updateMany({
      where: { cardId, isPrimary: true },
      data: { isPrimary: false },
    });
  }

  async findPhotoById(photoId: string): Promise<CardPhotoEntity | null> {
    return this.prisma.cardPhoto.findUnique({ where: { id: photoId } });
  }

  // Decimal -> number conversion is a persistence detail; the domain and
  // everything above it only ever sees plain numbers.
  private toEntity(card: CardWithPhotos): CardEntity {
    return { ...card, guessedPrice: Number(card.guessedPrice) };
  }
}
