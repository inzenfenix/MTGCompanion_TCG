import { Inject, Injectable } from '@nestjs/common';
import {
  PROCESSING_CONTROL_REPOSITORY,
  type LiftReason,
  type NewControl,
  type ProcessingControlEntity,
  type ProcessingControlRepository,
} from '../domain/processing-control.repository';

/** Kept in sync with rights-policy.ts BLOCKING_SCOPE (not imported, to keep this module dependency-free). */
const BLOCKING_SCOPE = 'NON_ESSENTIAL_PROCESSING';

/**
 * The one question every process an objection or a blocking can stop asks
 * at the moment it runs (ROADMAP.md O16, ACTIVIDAD_6.md §6) — same idea as
 * ConsentService.hasConsent: no cached flag, so lifting or granting one
 * takes effect from the very next operation.
 *
 *   isBlocked(user)              Bazaar search, new offers on their cards,
 *                                saving their location, optional emails,
 *                                sales report (art. 8 ter / 11)
 *   hasObjection(user, purpose)  the process behind that purpose (art. 8)
 *
 * Depends only on Prisma (global), so any module can import it without
 * creating a cycle with DataRightsModule, which is the one that writes.
 */
@Injectable()
export class ProcessingControlService {
  constructor(
    @Inject(PROCESSING_CONTROL_REPOSITORY)
    private readonly controls: ProcessingControlRepository,
  ) {}

  async isBlocked(userId: string): Promise<boolean> {
    return !!(await this.controls.findActive(userId, 'BLOCKING'));
  }

  async hasObjection(userId: string, purpose: string): Promise<boolean> {
    return !!(await this.controls.findActive(userId, 'OBJECTION', purpose));
  }

  activeBlocking(userId: string) {
    return this.controls.findActive(userId, 'BLOCKING');
  }

  activeObjection(userId: string, purpose: string) {
    return this.controls.findActive(userId, 'OBJECTION', purpose);
  }

  history(userId: string): Promise<ProcessingControlEntity[]> {
    return this.controls.findForUser(userId);
  }

  /** null = one was already active (nothing new was created). */
  objectTo(userId: string, purpose: string, requestId: string) {
    return this.controls.createActive({
      userId,
      kind: 'OBJECTION',
      scope: purpose,
      requestId,
    });
  }

  /** null = a blocking was already active. */
  block(
    userId: string,
    basis: string,
    requestId: string,
    relatedRequestId?: string | null,
  ) {
    const c: NewControl = {
      userId,
      kind: 'BLOCKING',
      scope: BLOCKING_SCOPE,
      basis,
      requestId,
      relatedRequestId: relatedRequestId ?? null,
    };
    return this.controls.createActive(c);
  }

  lift(control: ProcessingControlEntity, reason: LiftReason) {
    return this.controls.lift(control.id, reason);
  }

  /** Art. 11: the blocking lasts "mientras dicha solicitud no se resuelva". */
  async liftForClosedRequest(
    requestId: string,
  ): Promise<ProcessingControlEntity[]> {
    const active = await this.controls.findActiveByRelatedRequest(requestId);
    return Promise.all(
      active.map((c) => this.controls.lift(c.id, 'RELATED_REQUEST_CLOSED')),
    );
  }
}
