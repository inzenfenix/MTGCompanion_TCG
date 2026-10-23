import type { ConsentPurposeCode } from './consent-purposes';

export type ConsentState = 'GRANTED' | 'REVOKED';

/** "app" = the Privacy screen, "two-factor" = the 2FA flow, "erasure"/"migration" = system. */
export type ConsentSource = 'app' | 'two-factor' | 'erasure' | 'migration';

export interface ConsentRecord {
  purpose: string;
  version: string;
  status: ConsentState;
  grantedAt: Date;
  revokedAt: Date | null;
}

export interface ConsentHistoryEntry {
  purpose: string;
  action: ConsentState;
  version: string;
  textHash: string;
  source: string;
  createdAt: Date;
}

export interface ConsentChange {
  userId: string;
  purpose: ConsentPurposeCode;
  status: ConsentState;
  version: string;
  textHash: string;
  source: ConsentSource;
  at: Date;
}

export interface ConsentRepository {
  findForUser(userId: string): Promise<ConsentRecord[]>;
  find(
    userId: string,
    purpose: ConsentPurposeCode,
  ): Promise<ConsentRecord | null>;
  history(userId: string): Promise<ConsentHistoryEntry[]>;
  /**
   * Upserts the current state, appends a history event and applies the
   * purpose's side effect on user_settings (location erased, email flag
   * mirrored) — all in one database transaction, so a revocation can't end
   * up recorded without its effect or the other way around.
   */
  apply(change: ConsentChange): Promise<ConsentRecord>;
}

export const CONSENT_REPOSITORY = Symbol('CONSENT_REPOSITORY');
