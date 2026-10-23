import {
  ConflictException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { AuditService } from '../../common/audit/audit.service';
import type { Role } from '../../common/auth/permissions';
import {
  CONSENT_PURPOSES,
  isConsentPurpose,
  purposeTextHash,
  type ConsentPurposeCode,
  type ConsentPurposeDefinition,
} from '../domain/consent-purposes';
import {
  CONSENT_REPOSITORY,
  type ConsentHistoryEntry,
  type ConsentRecord,
  type ConsentRepository,
  type ConsentSource,
} from '../domain/consent.repository';

export interface ConsentActor {
  id: string;
  role: Role;
}

export type PurposeView = ConsentPurposeDefinition & { textHash: string };

export interface ConsentView {
  purpose: ConsentPurposeCode;
  title: string;
  currentVersion: string;
  /** NONE = never asked/answered. */
  status: 'GRANTED' | 'REVOKED' | 'NONE';
  acceptedVersion: string | null;
  /** Granted, but to an older text — doesn't count until accepted again. */
  requiresReconsent: boolean;
  /** What hasConsent() answers right now for this purpose. */
  effective: boolean;
  grantedAt: Date | null;
  revokedAt: Date | null;
  selfService: boolean;
}

/**
 * Consent per purpose (ROADMAP.md O15, ACTIVIDAD_5.md §1). Every process
 * that depends on a consent asks hasConsent(user, thatPurpose) at the
 * moment it runs — never another purpose, never a "consented to
 * something" flag — so granting one purpose can't enable another.
 */
@Injectable()
export class ConsentService {
  constructor(
    @Inject(CONSENT_REPOSITORY) private readonly consents: ConsentRepository,
    private readonly audit: AuditService,
  ) {}

  purposes(): PurposeView[] {
    return Object.values(CONSENT_PURPOSES).map((p) => ({
      ...p,
      textHash: purposeTextHash(p),
    }));
  }

  /** The one question dependent processes ask. Fails closed: no row, revoked or outdated → false. */
  async hasConsent(
    userId: string,
    purpose: ConsentPurposeCode,
  ): Promise<boolean> {
    const row = await this.consents.find(userId, purpose);
    return (
      row?.status === 'GRANTED' &&
      row.version === CONSENT_PURPOSES[purpose].version
    );
  }

  async listForUser(userId: string): Promise<ConsentView[]> {
    const rows = new Map(
      (await this.consents.findForUser(userId)).map((r) => [r.purpose, r]),
    );
    return Object.values(CONSENT_PURPOSES).map((def) =>
      this.toView(def, rows.get(def.code) ?? null),
    );
  }

  history(userId: string): Promise<ConsentHistoryEntry[]> {
    return this.consents.history(userId);
  }

  /** POST /consents/me/:purpose — the player accepts the text of `version`. */
  async grantFromApp(actor: ConsentActor, code: string, version: string) {
    const def = this.selfServicePurpose(code);
    // The client must echo the version it displayed: accepting "1" when the
    // current text is "2" means the player saw outdated wording.
    if (version !== def.version) {
      throw new ConflictException(
        `Consent text changed — current version is ${def.version}`,
      );
    }
    return this.toView(
      def,
      await this.change(actor, def.code, 'GRANTED', 'app'),
    );
  }

  /** DELETE /consents/me/:purpose — revocation, any time, no reason needed (art. 12). */
  async revokeFromApp(actor: ConsentActor, code: string) {
    const def = this.selfServicePurpose(code);
    return this.toView(
      def,
      await this.change(actor, def.code, 'REVOKED', 'app'),
    );
  }

  /**
   * For flows that own their purpose (2FA) and for erasure. Idempotent: a
   * grant of an already-current consent, or a revocation of one that isn't
   * granted, writes nothing.
   */
  async change(
    actor: ConsentActor,
    purpose: ConsentPurposeCode,
    status: 'GRANTED' | 'REVOKED',
    source: ConsentSource,
  ): Promise<ConsentRecord | null> {
    const def = CONSENT_PURPOSES[purpose];
    const current = await this.consents.find(actor.id, purpose);
    const unchanged =
      status === 'GRANTED'
        ? current?.status === 'GRANTED' && current.version === def.version
        : current?.status !== 'GRANTED';
    if (unchanged) return current;

    const record = await this.consents.apply({
      userId: actor.id,
      purpose,
      status,
      version:
        status === 'GRANTED' ? def.version : (current?.version ?? def.version),
      textHash: purposeTextHash(def),
      source,
      at: new Date(),
    });
    await this.audit.record({
      actorId: actor.id,
      actorRole: actor.role,
      action: status === 'GRANTED' ? 'consent.grant' : 'consent.revoke',
      resourceType: 'consent',
      resourceRef: purpose,
      reason: `v${record.version} via ${source}`,
      outcome: 'ALLOWED',
    });
    return record;
  }

  private selfServicePurpose(code: string): ConsentPurposeDefinition {
    if (!isConsentPurpose(code)) {
      throw new NotFoundException('Unknown consent purpose');
    }
    const def = CONSENT_PURPOSES[code];
    if (!def.selfService) {
      throw new ConflictException(
        `This consent is managed through ${def.managedBy}`,
      );
    }
    return def;
  }

  private toView(
    def: ConsentPurposeDefinition,
    row: ConsentRecord | null,
  ): ConsentView {
    const granted = row?.status === 'GRANTED';
    const current = row?.version === def.version;
    return {
      purpose: def.code,
      title: def.title,
      currentVersion: def.version,
      status: row?.status ?? 'NONE',
      acceptedVersion: row?.version ?? null,
      requiresReconsent: granted && !current,
      effective: granted && current,
      grantedAt: row?.grantedAt ?? null,
      revokedAt: row?.revokedAt ?? null,
      selfService: def.selfService,
    };
  }
}
