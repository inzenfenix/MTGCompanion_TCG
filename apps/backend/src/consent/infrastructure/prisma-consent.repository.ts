import { Injectable } from '@nestjs/common';
import type { Prisma } from '../../../generated/prisma';
import { PrismaService } from '../../prisma/prisma.service';
import type { ConsentPurposeCode } from '../domain/consent-purposes';
import type {
  ConsentChange,
  ConsentHistoryEntry,
  ConsentRecord,
  ConsentRepository,
} from '../domain/consent.repository';

const RECORD_SELECT = {
  purpose: true,
  version: true,
  status: true,
  grantedAt: true,
  revokedAt: true,
} as const;

@Injectable()
export class PrismaConsentRepository implements ConsentRepository {
  constructor(private readonly prisma: PrismaService) {}

  findForUser(userId: string): Promise<ConsentRecord[]> {
    return this.prisma.consent.findMany({
      where: { userId },
      select: RECORD_SELECT,
    });
  }

  find(userId: string, purpose: ConsentPurposeCode) {
    return this.prisma.consent.findUnique({
      where: { userId_purpose: { userId, purpose } },
      select: RECORD_SELECT,
    });
  }

  async history(userId: string): Promise<ConsentHistoryEntry[]> {
    const rows = await this.prisma.consentEvent.findMany({
      where: { consent: { userId } },
      orderBy: { createdAt: 'desc' },
      select: {
        action: true,
        version: true,
        textHash: true,
        source: true,
        createdAt: true,
        consent: { select: { purpose: true } },
      },
    });
    return rows.map(({ consent, ...e }) => ({
      purpose: consent.purpose,
      ...e,
    }));
  }

  apply(change: ConsentChange): Promise<ConsentRecord> {
    return this.prisma.$transaction(async (tx) => {
      const granted = change.status === 'GRANTED';
      const consent = await tx.consent.upsert({
        where: {
          userId_purpose: { userId: change.userId, purpose: change.purpose },
        },
        create: {
          userId: change.userId,
          purpose: change.purpose,
          version: change.version,
          status: change.status,
          grantedAt: change.at,
          revokedAt: granted ? null : change.at,
        },
        update: granted
          ? {
              version: change.version,
              status: 'GRANTED',
              grantedAt: change.at,
              revokedAt: null,
            }
          : { status: 'REVOKED', revokedAt: change.at },
      });
      await tx.consentEvent.create({
        data: {
          consentId: consent.id,
          action: change.status,
          version: change.version,
          textHash: change.textHash,
          source: change.source,
          createdAt: change.at,
        },
      });
      await this.applyEffect(tx, change);
      return {
        purpose: consent.purpose,
        version: consent.version,
        status: consent.status,
        grantedAt: consent.grantedAt,
        revokedAt: consent.revokedAt,
      };
    });
  }

  // How a consent change reaches the processes that depend on it (ACTIVIDAD_5.md
  // §1.4). Gates (hasConsent) stop future processing; this erases what was
  // collected under a consent that no longer exists.
  private async applyEffect(
    tx: Prisma.TransactionClient,
    change: ConsentChange,
  ) {
    const granted = change.status === 'GRANTED';
    switch (change.purpose) {
      case 'LOCATION_DISTANCE':
        if (!granted) {
          await tx.userSettings.updateMany({
            where: { userId: change.userId },
            data: {
              shareLocation: false,
              lastLat: null,
              lastLng: null,
              locationUpdatedAt: null,
            },
          });
        }
        return;
      case 'EMAIL_NOTIFICATIONS':
        await tx.userSettings.updateMany({
          where: { userId: change.userId },
          data: { notifyByEmail: granted },
        });
        return;
      case 'TWO_FACTOR':
        // The 2FA flow (UsersService) already wrote/erased the secret.
        return;
    }
  }
}
