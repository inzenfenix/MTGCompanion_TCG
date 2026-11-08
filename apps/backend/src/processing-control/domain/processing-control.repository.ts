/**
 * ROADMAP.md O16 (ACTIVIDAD_6.md §6) — what an upheld objection or a granted
 * blocking leaves behind. See schema.prisma `ProcessingControl`.
 */
export type ControlKind = 'OBJECTION' | 'BLOCKING';
export type LiftReason = 'HOLDER_WITHDREW' | 'RELATED_REQUEST_CLOSED';

export interface ProcessingControlEntity {
  id: string;
  userId: string;
  kind: ControlKind;
  scope: string;
  basis: string | null;
  status: 'ACTIVE' | 'LIFTED';
  requestId: string;
  relatedRequestId: string | null;
  createdAt: Date;
  liftedAt: Date | null;
  liftReason: string | null;
}

export interface NewControl {
  userId: string;
  kind: ControlKind;
  scope: string;
  basis?: string | null;
  requestId: string;
  relatedRequestId?: string | null;
}

export interface ProcessingControlRepository {
  findActive(
    userId: string,
    kind: ControlKind,
    scope?: string,
  ): Promise<ProcessingControlEntity | null>;
  /** Both active and lifted, newest first. */
  findForUser(userId: string): Promise<ProcessingControlEntity[]>;
  /**
   * Inserts an ACTIVE control. Returns null when one is already active for
   * (user, kind, scope) — the partial unique index decides, so two
   * concurrent requests can't both create one.
   */
  createActive(c: NewControl): Promise<ProcessingControlEntity | null>;
  lift(id: string, reason: LiftReason): Promise<ProcessingControlEntity>;
  findActiveByRelatedRequest(
    requestId: string,
  ): Promise<ProcessingControlEntity[]>;
}

export const PROCESSING_CONTROL_REPOSITORY = Symbol(
  'PROCESSING_CONTROL_REPOSITORY',
);
