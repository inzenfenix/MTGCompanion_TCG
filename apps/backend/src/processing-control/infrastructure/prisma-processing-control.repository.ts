import { Injectable } from '@nestjs/common';
import type { Prisma } from '../../../generated/prisma';
import { PrismaService } from '../../prisma/prisma.service';
import type {
  ControlKind,
  LiftReason,
  NewControl,
  ProcessingControlEntity,
  ProcessingControlRepository,
} from '../domain/processing-control.repository';

/**
 * Prisma filter for "this user's data may be processed for non-essential
 * purposes right now" — used inside other modules' queries (Bazaar search)
 * so a blocked seller is excluded by the database, not filtered afterwards.
 */
export const NOT_BLOCKED: Prisma.UserWhereInput = {
  processingControls: { none: { kind: 'BLOCKING', status: 'ACTIVE' } },
};

/** P2002 from Prisma, or the raw 23505 the pg driver adapter may surface. */
function isUniqueViolation(err: unknown): boolean {
  const e = err as {
    code?: string;
    cause?: { code?: string; originalCode?: string };
    message?: string;
  };
  return (
    e?.code === 'P2002' ||
    e?.cause?.code === '23505' ||
    e?.cause?.originalCode === '23505' ||
    (e?.message ?? '').includes('processing_controls_one_active')
  );
}

@Injectable()
export class PrismaProcessingControlRepository implements ProcessingControlRepository {
  constructor(private readonly prisma: PrismaService) {}

  findActive(userId: string, kind: ControlKind, scope?: string) {
    return this.prisma.processingControl.findFirst({
      where: { userId, kind, status: 'ACTIVE', ...(scope ? { scope } : {}) },
    }) as Promise<ProcessingControlEntity | null>;
  }

  findForUser(userId: string) {
    return this.prisma.processingControl.findMany({
      where: { userId },
      orderBy: { createdAt: 'desc' },
    }) as Promise<ProcessingControlEntity[]>;
  }

  async createActive(c: NewControl) {
    try {
      return await this.prisma.processingControl.create({
        data: {
          userId: c.userId,
          kind: c.kind,
          scope: c.scope,
          basis: c.basis ?? null,
          requestId: c.requestId,
          relatedRequestId: c.relatedRequestId ?? null,
        },
      });
    } catch (err) {
      // processing_controls_one_active: one is already in force.
      if (isUniqueViolation(err)) return null;
      throw err;
    }
  }

  lift(id: string, reason: LiftReason) {
    return this.prisma.processingControl.update({
      where: { id },
      data: { status: 'LIFTED', liftedAt: new Date(), liftReason: reason },
    }) as Promise<ProcessingControlEntity>;
  }

  findActiveByRelatedRequest(requestId: string) {
    return this.prisma.processingControl.findMany({
      where: { relatedRequestId: requestId, status: 'ACTIVE' },
    }) as Promise<ProcessingControlEntity[]>;
  }
}
