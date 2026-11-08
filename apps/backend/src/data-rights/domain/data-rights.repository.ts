import type { ErasureFacts, RightsChannel, RightsType } from './rights-policy';

export type RequestStatus =
  | 'AWAITING_CONFIRMATION'
  | 'PENDING_STEP_UP'
  | 'RECEIVED'
  | 'VERIFIED'
  | 'IN_EVALUATION'
  | 'CLOSED';
export type RequestOutcome = 'FULFILLED' | 'DENIED';

export interface RightsRequestEntity {
  id: string;
  /** Null only for a public-form request about an address with no account. */
  userId: string | null;
  type: RightsType;
  status: RequestStatus;
  outcome: RequestOutcome | null;
  channel: RightsChannel;
  scope: string | null;
  statement: string | null;
  relatedRequestId: string | null;
  requestBlocking: boolean;
  contactPseudonym: string | null;
  expiresAt: Date | null;
  verificationMethod: string | null;
  details: Record<string, unknown> | null;
  receivedAt: Date;
  verifiedAt: Date | null;
  evaluatedAt: Date | null;
  executedAt: Date | null;
  closedAt: Date | null;
  dueAt: Date;
}

export interface ErasureResult {
  mode: 'delete' | 'tombstone';
  cardsDeleted: number;
  cardsKeptForTransactions: number;
  photosDeleted: number;
  offersDeleted: number;
  decksDeleted: number;
  couponsDeleted: number;
  /** Bucket objects to remove after the DB transaction commits. */
  storageKeys: string[];
}

export interface NewRightsRequest {
  userId: string | null;
  type: RightsType;
  receivedAt: Date;
  dueAt: Date;
  channel?: RightsChannel;
  status?: RequestStatus;
  scope?: string | null;
  statement?: string | null;
  relatedRequestId?: string | null;
  requestBlocking?: boolean;
  contactPseudonym?: string | null;
  confirmTokenHash?: string | null;
  expiresAt?: Date | null;
}

export interface DataRightsRepository {
  create(input: NewRightsRequest): Promise<RightsRequestEntity>;
  /** O16 — the AWAITING_CONFIRMATION request behind a confirmation code hash. */
  findByConfirmHash(hash: string): Promise<RightsRequestEntity | null>;
  /**
   * O16 — burns the code and records the mailbox proof, atomically: only
   * one caller can win (false = already consumed by someone else).
   */
  consumeConfirmation(id: string, hash: string): Promise<boolean>;
  setPendingStepUp(id: string, expiresAt: Date): Promise<RightsRequestEntity>;
  countPublicSince(contactPseudonym: string, since: Date): Promise<number>;
  /** Open public-form requests whose holder step is past `expiresAt`. */
  findExpiredOpen(now: Date): Promise<RightsRequestEntity[]>;
  /** Throws a unique-constraint error if `stepUpJti` was already consumed. */
  markVerified(
    id: string,
    method: string,
    stepUpJti: string | null,
  ): Promise<void>;
  markInEvaluation(id: string): Promise<void>;
  close(
    id: string,
    outcome: RequestOutcome,
    details: Record<string, unknown>,
    executed: boolean,
  ): Promise<RightsRequestEntity>;
  findForUser(userId: string): Promise<RightsRequestEntity[]>;
  findOneForUser(
    id: string,
    userId: string,
  ): Promise<RightsRequestEntity | null>;
  list(status?: RequestStatus, limit?: number): Promise<RightsRequestEntity[]>;

  /** Everything the portability export needs, already filtered to the subject's own data. */
  collectExport(userId: string): Promise<Record<string, unknown>>;
  erasureFacts(
    userId: string,
  ): Promise<ErasureFacts & { totalTransactions: number }>;
  /** Erases (or tombstones) the account in one DB transaction. */
  erase(userId: string, mode: 'delete' | 'tombstone'): Promise<ErasureResult>;
}

export const DATA_RIGHTS_REPOSITORY = Symbol('DATA_RIGHTS_REPOSITORY');
