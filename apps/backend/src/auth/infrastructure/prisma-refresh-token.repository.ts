import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import type {
  CreateRefreshTokenData,
  RefreshTokenEntity,
  RefreshTokenRepository,
} from '../domain/refresh-token.repository';

@Injectable()
export class PrismaRefreshTokenRepository implements RefreshTokenRepository {
  constructor(private readonly prisma: PrismaService) {}

  create(data: CreateRefreshTokenData): Promise<RefreshTokenEntity> {
    return this.prisma.refreshToken.create({ data });
  }

  findByHash(tokenHash: string): Promise<RefreshTokenEntity | null> {
    return this.prisma.refreshToken.findUnique({ where: { tokenHash } });
  }

  async deleteById(id: string): Promise<void> {
    // Rotation calls this for a row it just read, and refresh() calls it
    // again for an expired row it's cleaning up — either way the row might
    // already be gone by the time this runs (e.g. a race between two
    // refresh calls with the same token). Not an error case worth
    // surfacing, so swallow Prisma's "record not found" (P2025) specifically
    // and let anything else propagate.
    try {
      await this.prisma.refreshToken.delete({ where: { id } });
    } catch (err) {
      if ((err as { code?: string }).code !== 'P2025') throw err;
    }
  }
}
