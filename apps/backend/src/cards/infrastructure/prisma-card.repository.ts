import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import type {
  AuctionStateUpdate,
  CardRepository,
  CreateCardData,
  DeckFilter,
  SearchListingsParams,
  UpdateCardData,
} from '../domain/card.repository';
import type {
  CardEntity,
  CardListingEntity,
  CardPhotoEntity,
} from '../domain/card.entity';
import type { Card, CardOrigin, CardPhoto } from '../../../generated/prisma';

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

  async findAllByOwner(
    ownerId: string,
    origin?: CardOrigin,
    deckId?: DeckFilter,
  ): Promise<CardEntity[]> {
    const deckWhere =
      deckId === undefined
        ? {}
        : { deckId: deckId === 'unsorted' ? null : deckId };
    const cards = await this.prisma.card.findMany({
      where: { ownerId, ...(origin ? { origin } : {}), ...deckWhere },
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

  async updateAuctionState(
    id: string,
    data: AuctionStateUpdate,
  ): Promise<CardEntity> {
    const card = await this.prisma.card.update({
      where: { id },
      data: { closesAt: data.closesAt, wonOfferId: data.wonOfferId },
      include: { photos: true },
    });
    return this.toEntity(card);
  }

  async transferOwnership(id: string, newOwnerId: string): Promise<CardEntity> {
    const card = await this.prisma.card.update({
      where: { id },
      data: { owner: { connect: { id: newOwnerId } } },
      include: { photos: true },
    });
    return this.toEntity(card);
  }

  async delete(id: string): Promise<void> {
    await this.prisma.card.delete({ where: { id } });
  }

  // Only shareLocation:true owners' lat/lng ever surface here — a user who
  // has never opted in (or hasn't yet) shows up with ownerLat/ownerLng both
  // null, same as "no location on file" rather than defaulting to 0,0.
  async searchListings(
    params: SearchListingsParams,
  ): Promise<CardListingEntity[]> {
    const { q, scryfallId, excludeOwnerId, limit } = params;
    const cards = await this.prisma.card.findMany({
      where: {
        ...(scryfallId ? { scryfallId } : {}),
        ...(q ? { title: { contains: q, mode: 'insensitive' } } : {}),
        ...(excludeOwnerId ? { ownerId: { not: excludeOwnerId } } : {}),
      },
      include: {
        owner: {
          select: {
            displayName: true,
            settings: {
              select: { lastLat: true, lastLng: true, shareLocation: true },
            },
          },
        },
      },
      orderBy: { createdAt: 'desc' },
      take: limit,
    });

    return cards.map(({ owner, ...card }) => {
      const shares = owner.settings?.shareLocation ?? false;
      return {
        ...card,
        guessedPrice: Number(card.guessedPrice),
        photos: [],
        ownerDisplayName: owner.displayName,
        ownerLat: shares ? (owner.settings?.lastLat ?? null) : null,
        ownerLng: shares ? (owner.settings?.lastLng ?? null) : null,
      };
    });
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
