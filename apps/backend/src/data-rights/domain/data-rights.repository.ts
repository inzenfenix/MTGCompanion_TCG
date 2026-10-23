import type { ErasureFacts, RightsType } from './rights-policy';

export type RequestStatus =
  'RECEIVED' | 'VERIFIED' | 'IN_EVALUATION' | 'CLOSED';
export type RequestOutcome = 'FULFILLED' | 'DENIED';

export interface RightsRequestEntity {
  id: string;
  userId: string;
  type: RightsType;
  status: RequestStatus;
  outcome: RequestOutcome | null;
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

export interface DataRightsRepository {
  create(
    userId: string,
    type: RightsType,
    receivedAt: Date,
    dueAt: Date,
  ): Promise<RightsRequestEntity>;
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
