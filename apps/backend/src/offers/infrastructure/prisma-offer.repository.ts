import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import type {
  CreateOfferData,
  OfferRepository,
} from '../domain/offer.repository';
import type { OfferEntity } from '../domain/offer.entity';
import type { Offer } from '../../../generated/prisma';

@Injectable()
export class PrismaOfferRepository implements OfferRepository {
  constructor(private readonly prisma: PrismaService) {}

  async create(data: CreateOfferData): Promise<OfferEntity> {
    const offer = await this.prisma.offer.create({
      data: {
        amount: data.amount,
        card: { connect: { id: data.cardId } },
        bidder: { connect: { id: data.bidderId } },
      },
    });
    return this.toEntity(offer);
  }

  async findLatestForCard(cardId: string): Promise<OfferEntity | null> {
    const offer = await this.prisma.offer.findFirst({
      where: { cardId },
      orderBy: { createdAt: 'desc' },
    });
    return offer ? this.toEntity(offer) : null;
  }

  async findAllForCard(cardId: string): Promise<OfferEntity[]> {
    const offers = await this.prisma.offer.findMany({
      where: { cardId },
      orderBy: { createdAt: 'desc' },
    });
    return offers.map((offer) => this.toEntity(offer));
  }

  async findById(id: string): Promise<OfferEntity | null> {
    const offer = await this.prisma.offer.findUnique({ where: { id } });
    return offer ? this.toEntity(offer) : null;
  }

  private toEntity(offer: Offer): OfferEntity {
    return { ...offer, amount: Number(offer.amount) };
  }
}
