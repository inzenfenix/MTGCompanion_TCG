import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import type {
  CouponRepository,
  CreateCouponData,
} from '../domain/coupon.repository';
import type { CouponEntity } from '../domain/coupon.entity';
import type { Coupon } from '../../../generated/prisma';

@Injectable()
export class PrismaCouponRepository implements CouponRepository {
  constructor(private readonly prisma: PrismaService) {}

  async create(data: CreateCouponData): Promise<CouponEntity> {
    const coupon = await this.prisma.coupon.create({
      data: {
        discountPercent: data.discountPercent,
        maxDiscount: data.maxDiscount,
        expiresAt: data.expiresAt,
        issuedToUser: { connect: { id: data.issuedToUserId } },
      },
    });
    return this.toEntity(coupon);
  }

  async findById(id: string): Promise<CouponEntity | null> {
    const coupon = await this.prisma.coupon.findUnique({ where: { id } });
    return coupon ? this.toEntity(coupon) : null;
  }

  async findLatestForUser(userId: string): Promise<CouponEntity | null> {
    const coupon = await this.prisma.coupon.findFirst({
      where: { issuedToUserId: userId },
      orderBy: { createdAt: 'desc' },
    });
    return coupon ? this.toEntity(coupon) : null;
  }

  async findAvailableForUser(userId: string): Promise<CouponEntity[]> {
    const coupons = await this.prisma.coupon.findMany({
      where: {
        issuedToUserId: userId,
        redeemedAt: null,
        expiresAt: { gt: new Date() },
      },
      orderBy: { createdAt: 'desc' },
    });
    return coupons.map((coupon) => this.toEntity(coupon));
  }

  async markRedeemed(id: string, transactionId: string): Promise<CouponEntity> {
    const coupon = await this.prisma.coupon.update({
      where: { id },
      data: { redeemedAt: new Date(), redeemedInTransactionId: transactionId },
    });
    return this.toEntity(coupon);
  }

  async deleteAll(): Promise<number> {
    const { count } = await this.prisma.coupon.deleteMany({});
    return count;
  }

  private toEntity(coupon: Coupon): CouponEntity {
    return { ...coupon, maxDiscount: Number(coupon.maxDiscount) };
  }
}
