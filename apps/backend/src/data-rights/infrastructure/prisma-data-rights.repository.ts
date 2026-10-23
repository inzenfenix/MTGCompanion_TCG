import { randomUUID } from 'node:crypto';
import { Injectable } from '@nestjs/common';
import type { Prisma } from '../../../generated/prisma';
import { FieldEncryptionService } from '../../common/crypto/field-encryption.service';
import { PrismaService } from '../../prisma/prisma.service';
import type {
  DataRightsRepository,
  ErasureResult,
  RequestOutcome,
  RequestStatus,
  RightsRequestEntity,
} from '../domain/data-rights.repository';
import type { ErasureFacts, RightsType } from '../domain/rights-policy';

type Row = Prisma.DataRightsRequestGetPayload<object>;

// What a tombstoned account is shown as on the other party's transactions.
export const ERASED_DISPLAY_NAME = 'Cuenta eliminada';

/**
 * Reads and writes across the tables that hold a player's data — the one
 * place that knows the whole footprint of an account, which is exactly
 * what an access request and an erasure need. Every query is scoped by the
 * subject's own user id; nothing here takes an id from a request body.
 */
@Injectable()
export class PrismaDataRightsRepository implements DataRightsRepository {
  constructor(
    private readonly prisma: PrismaService,
    private readonly crypto: FieldEncryptionService,
  ) {}

  private toEntity(row: Row): RightsRequestEntity {
    return {
      ...row,
      details: (row.details as Record<string, unknown> | null) ?? null,
    };
  }

  async create(
    userId: string,
    type: RightsType,
    receivedAt: Date,
    dueAt: Date,
  ): Promise<RightsRequestEntity> {
    return this.toEntity(
      await this.prisma.dataRightsRequest.create({
        data: { userId, type, receivedAt, dueAt },
      }),
    );
  }

  async markVerified(id: string, method: string, stepUpJti: string | null) {
    await this.prisma.dataRightsRequest.update({
      where: { id },
      data: {
        status: 'VERIFIED',
        verificationMethod: method,
        stepUpJti,
        verifiedAt: new Date(),
      },
    });
  }

  async markInEvaluation(id: string) {
    await this.prisma.dataRightsRequest.update({
      where: { id },
      data: { status: 'IN_EVALUATION', evaluatedAt: new Date() },
    });
  }

  async close(
    id: string,
    outcome: RequestOutcome,
    details: Record<string, unknown>,
    executed: boolean,
  ): Promise<RightsRequestEntity> {
    const now = new Date();
    return this.toEntity(
      await this.prisma.dataRightsRequest.update({
        where: { id },
        data: {
          status: 'CLOSED',
          outcome,
          details: details as Prisma.InputJsonValue,
          closedAt: now,
          ...(executed ? { executedAt: now } : {}),
        },
      }),
    );
  }

  async findForUser(userId: string) {
    const rows = await this.prisma.dataRightsRequest.findMany({
      where: { userId },
      orderBy: { receivedAt: 'desc' },
    });
    return rows.map((r) => this.toEntity(r));
  }

  async findOneForUser(id: string, userId: string) {
    const row = await this.prisma.dataRightsRequest.findFirst({
      where: { id, userId },
    });
    return row ? this.toEntity(row) : null;
  }

  async list(status?: RequestStatus, limit = 100) {
    const rows = await this.prisma.dataRightsRequest.findMany({
      where: status ? { status } : {},
      orderBy: { receivedAt: 'desc' },
      take: limit,
    });
    return rows.map((r) => this.toEntity(r));
  }

  async collectExport(userId: string): Promise<Record<string, unknown>> {
    const user = await this.prisma.user.findUniqueOrThrow({
      where: { id: userId },
      include: { settings: true },
    });
    const [
      cards,
      decks,
      offers,
      transactions,
      coupons,
      consents,
      events,
      requests,
    ] = await Promise.all([
      this.prisma.card.findMany({
        where: { ownerId: userId },
        orderBy: { createdAt: 'asc' },
        include: {
          deck: { select: { name: true } },
          _count: { select: { photos: true } },
        },
      }),
      this.prisma.deck.findMany({
        where: { ownerId: userId },
        orderBy: { createdAt: 'asc' },
      }),
      this.prisma.offer.findMany({
        where: { bidderId: userId },
        orderBy: { createdAt: 'asc' },
        include: { card: { select: { title: true } } },
      }),
      this.prisma.transaction.findMany({
        where: { OR: [{ buyerId: userId }, { sellerId: userId }] },
        orderBy: { createdAt: 'asc' },
        include: {
          card: { select: { title: true } },
          buyer: { select: { displayName: true } },
          seller: { select: { displayName: true } },
        },
      }),
      this.prisma.coupon.findMany({
        where: { issuedToUserId: userId },
        orderBy: { createdAt: 'asc' },
      }),
      this.prisma.consent.findMany({ where: { userId } }),
      this.prisma.consentEvent.findMany({
        where: { consent: { userId } },
        orderBy: { createdAt: 'asc' },
        include: { consent: { select: { purpose: true } } },
      }),
      this.prisma.dataRightsRequest.findMany({
        where: { userId },
        orderBy: { receivedAt: 'asc' },
      }),
    ]);

    const s = user.settings;
    return {
      account: {
        id: user.id,
        email: user.email,
        displayName: user.displayName,
        emailVerifiedAt: user.emailVerifiedAt,
        adultDeclarationAt: user.adultConfirmedAt,
        role: user.role,
        createdAt: user.createdAt,
      },
      settings: s && {
        language: s.language,
        theme: s.theme,
        twoFactorEnabled: s.twoFactorEnabled,
        optionalEmails: s.notifyByEmail,
        // The player's own (already coarsened) location, decrypted — it is
        // their data. Null once revoked or expired.
        location: s.shareLocation
          ? {
              lat: this.crypto.decryptNumber(s.lastLat),
              lng: this.crypto.decryptNumber(s.lastLng),
              precision: '~1 km (2 decimales)',
              updatedAt: s.locationUpdatedAt,
            }
          : null,
      },
      consents: consents.map((c) => ({
        purpose: c.purpose,
        status: c.status,
        version: c.version,
        grantedAt: c.grantedAt,
        revokedAt: c.revokedAt,
      })),
      consentHistory: events.map((e) => ({
        purpose: e.consent.purpose,
        action: e.action,
        version: e.version,
        textSha256: e.textHash,
        source: e.source,
        at: e.createdAt,
      })),
      cards: cards.map((c) => ({
        id: c.id,
        title: c.title,
        description: c.description,
        askingPrice: c.guessedPrice.toString(),
        condition: c.condition,
        origin: c.origin,
        setName: c.setName,
        rarity: c.rarity,
        scryfallId: c.scryfallId,
        deck: c.deck?.name ?? null,
        photoCount: c._count.photos,
        createdAt: c.createdAt,
      })),
      decks: decks.map((d) => ({
        id: d.id,
        name: d.name,
        createdAt: d.createdAt,
      })),
      offersMade: offers.map((o) => ({
        cardTitle: o.card.title,
        amount: o.amount.toString(),
        at: o.createdAt,
      })),
      // The other party appears only by the public alias the app already
      // shows — never their id, email or anything else about them.
      transactions: transactions.map((t) => {
        const asBuyer = t.buyerId === userId;
        return {
          id: t.id,
          role: asBuyer ? 'buyer' : 'seller',
          cardTitle: t.card.title,
          amount: t.amount.toString(),
          status: t.status,
          paymentMethod: t.paymentMethod,
          counterparty: (asBuyer ? t.seller : t.buyer).displayName,
          createdAt: t.createdAt,
        };
      }),
      coupons: coupons.map((c) => ({
        discountPercent: c.discountPercent,
        maxDiscount: c.maxDiscount.toString(),
        expiresAt: c.expiresAt,
        redeemedAt: c.redeemedAt,
        createdAt: c.createdAt,
      })),
      rightsRequests: requests.map((r) => ({
        id: r.id,
        type: r.type,
        status: r.status,
        outcome: r.outcome,
        receivedAt: r.receivedAt,
        closedAt: r.closedAt,
      })),
    };
  }

  async erasureFacts(
    userId: string,
  ): Promise<ErasureFacts & { totalTransactions: number }> {
    const party = { OR: [{ buyerId: userId }, { sellerId: userId }] };
    const live: Prisma.CardWhereInput = {
      OR: [{ closesAt: { not: null } }, { wonOfferId: { not: null } }],
    };
    const [
      user,
      pendingTransactions,
      totalTransactions,
      activeAuctionsAsSeller,
      biddedLive,
    ] = await Promise.all([
      this.prisma.user.findUniqueOrThrow({
        where: { id: userId },
        select: { role: true },
      }),
      this.prisma.transaction.count({ where: { ...party, status: 'PENDING' } }),
      this.prisma.transaction.count({ where: party }),
      this.prisma.card.count({ where: { ownerId: userId, ...live } }),
      this.prisma.card.findMany({
        where: { ...live, offers: { some: { bidderId: userId } } },
        select: {
          offers: {
            orderBy: { createdAt: 'desc' },
            take: 1,
            select: { bidderId: true },
          },
        },
      }),
    ]);
    return {
      role: user.role,
      pendingTransactions,
      totalTransactions,
      activeAuctionsAsSeller,
      leadingBidsInActiveAuctions: biddedLive.filter(
        (c) => c.offers[0]?.bidderId === userId,
      ).length,
    };
  }

  erase(userId: string, mode: 'delete' | 'tombstone'): Promise<ErasureResult> {
    return this.prisma.$transaction(async (tx) => {
      const now = new Date();
      const cards = await tx.card.findMany({
        where: { ownerId: userId },
        select: {
          id: true,
          photos: { select: { storageKey: true } },
          _count: { select: { transactions: true } },
        },
      });
      const keepIds = cards
        .filter((c) => c._count.transactions > 0)
        .map((c) => c.id);
      const dropIds = cards
        .filter((c) => c._count.transactions === 0)
        .map((c) => c.id);

      const photos = await tx.cardPhoto.deleteMany({
        where: { cardId: { in: cards.map((c) => c.id) } },
      });
      const offers = await tx.offer.deleteMany({ where: { bidderId: userId } });
      const dropped = await tx.card.deleteMany({
        where: { id: { in: dropIds } },
      });
      // Cards a closed transaction points at stay (the receipt needs their
      // title and price), stripped of the player's own free text.
      await tx.card.updateMany({
        where: { id: { in: keepIds } },
        data: {
          description: null,
          deckId: null,
          closesAt: null,
          wonOfferId: null,
        },
      });
      const decks = await tx.deck.deleteMany({ where: { ownerId: userId } });
      const coupons = await tx.coupon.deleteMany({
        where: { issuedToUserId: userId, redeemedInTransactionId: null },
      });
      await tx.consent.deleteMany({ where: { userId } }); // + consent_events (cascade)
      await tx.refreshToken.deleteMany({ where: { userId } });

      if (mode === 'delete') {
        await tx.user.delete({ where: { id: userId } }); // settings cascade
      } else {
        await tx.userSettings.deleteMany({ where: { userId } });
        await tx.user.update({
          where: { id: userId },
          data: {
            // Unique and unroutable (.invalid is reserved, RFC 2606): keeps
            // the @unique constraint happy and can never receive mail.
            email: `erased-${randomUUID()}@erased.invalid`,
            displayName: ERASED_DISPLAY_NAME,
            // Not a bcrypt hash, so no password can ever match it.
            passwordHash: '!erased',
            emailVerifiedAt: null,
            adultConfirmedAt: null,
            role: 'USER',
            deletedAt: now,
            sessionsRevokedAt: now,
            disabledAt: null,
            lockedUntil: null,
          },
        });
      }

      return {
        mode,
        cardsDeleted: dropped.count,
        cardsKeptForTransactions: keepIds.length,
        photosDeleted: photos.count,
        offersDeleted: offers.count,
        decksDeleted: decks.count,
        couponsDeleted: coupons.count,
        storageKeys: cards.flatMap((c) => c.photos.map((p) => p.storageKey)),
      };
    });
  }
}
