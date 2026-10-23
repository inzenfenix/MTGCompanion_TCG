import {
  BadRequestException,
  ConflictException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { AuthService } from '../../auth/application/auth.service';
import type { RequestUser } from '../../auth/presentation/jwt.strategy';
import { AuditService } from '../../common/audit/audit.service';
import {
  DATA_RIGHTS_CLOSED_EVENT,
  DataRightsClosedEvent,
} from '../../common/events/data-rights-closed.event';
import { StorageService } from '../../storage/storage.service';
import { UsersService } from '../../users/application/users.service';
import {
  DATA_RIGHTS_REPOSITORY,
  type DataRightsRepository,
  type RequestStatus,
  type RightsRequestEntity,
} from '../domain/data-rights.repository';
import {
  EXPORT_FORMAT,
  EXPORT_VERSION,
  NOT_INCLUDED,
  PROCESSING_INFO,
} from '../domain/export-format';
import {
  DENIAL_MESSAGES,
  dueDateFor,
  erasureBlockers,
  erasureMode,
  requiresStepUp,
  type DenialReason,
  type RightsType,
} from '../domain/rights-policy';
import type { CreateRightsRequestDto } from '../presentation/dto/create-rights-request.dto';

export interface RequestView {
  id: string;
  type: RightsType;
  status: RequestStatus;
  outcome: 'FULFILLED' | 'DENIED' | null;
  message: string | null;
  verificationMethod: string | null;
  details: Record<string, unknown> | null;
  receivedAt: Date;
  verifiedAt: Date | null;
  evaluatedAt: Date | null;
  executedAt: Date | null;
  closedAt: Date | null;
  dueAt: Date;
}

const AUDIT_ACTION: Record<RightsType, string> = {
  ACCESS: 'data.export',
  RECTIFICATION: 'data.rectify',
  ERASURE: 'data.erase',
};

/**
 * Data-subject rights (ROADMAP.md O15, ACTIVIDAD_5.md §2). Every request,
 * whatever its type, walks the same recorded lifecycle:
 *
 *   RECEIVED ─► VERIFIED ─► IN_EVALUATION ─► (execution) ─► CLOSED
 *      │            │              │                          FULFILLED
 *      └────────────┴──────────────┴──────────────────────► CLOSED DENIED + reason
 *
 * Reception = the row (with its 30-day legal deadline); verification = the
 * session, plus a single-use step-up for the risky cases (rights-policy.ts);
 * evaluation = the business rules (erasure blockers, nothing to change);
 * execution = the actual export / update / erasure; closing = the answer,
 * recorded here, audited and emailed. Every query is scoped to the caller's
 * own account — there's no user id in any route or body.
 */
@Injectable()
export class DataRightsService {
  private readonly logger = new Logger(DataRightsService.name);

  constructor(
    @Inject(DATA_RIGHTS_REPOSITORY)
    private readonly requests: DataRightsRepository,
    private readonly auth: AuthService,
    private readonly users: UsersService,
    private readonly audit: AuditService,
    private readonly storage: StorageService,
    private readonly events: EventEmitter2,
  ) {}

  async submit(
    actor: RequestUser,
    dto: CreateRightsRequestDto,
  ): Promise<{ request: RequestView; export?: Record<string, unknown> }> {
    const profile = await this.users.findById(actor.id);
    if (!profile) throw new NotFoundException('User not found');
    if (dto.type === 'RECTIFICATION' && !dto.rectification) {
      throw new BadRequestException('rectification is required');
    }

    // 1. Reception
    const now = new Date();
    const req = await this.requests.create(
      actor.id,
      dto.type,
      now,
      dueDateFor(now),
    );
    const deny = (reason: DenialReason) =>
      this.finish(actor, profile, req, 'DENIED', { reason }, false);

    // 2. Verification
    const rectifiedFields = Object.entries(dto.rectification ?? {})
      .filter(([, v]) => v !== undefined)
      .map(([k]) => k);
    let method = 'session';
    let jti: string | null = null;
    if (requiresStepUp(dto.type, rectifiedFields)) {
      const stepUp = this.auth.checkStepUp(dto.stepUpToken, actor.id);
      if (!stepUp) return { request: await deny('IDENTITY_NOT_VERIFIED') };
      method = stepUp.method;
      jti = stepUp.jti;
    }
    try {
      await this.requests.markVerified(req.id, method, jti);
    } catch {
      // @unique on stepUpJti: this step-up token already backed a request.
      return { request: await deny('STEP_UP_REUSED') };
    }

    // 3. Evaluation
    await this.requests.markInEvaluation(req.id);
    if (dto.type === 'ERASURE') {
      const facts = await this.requests.erasureFacts(actor.id);
      const blockers = erasureBlockers(facts);
      if (blockers.length > 0) return { request: await deny(blockers[0]) };

      // 4. Execution
      const result = await this.requests.erase(
        actor.id,
        erasureMode(facts.totalTransactions),
      );
      const pendingStorage = await this.deleteObjects(result.storageKeys);
      return {
        request: await this.finish(
          actor,
          profile,
          req,
          'FULFILLED',
          {
            // Counts only — the storage keys themselves aren't kept.
            mode: result.mode,
            cardsDeleted: result.cardsDeleted,
            cardsKeptForTransactions: result.cardsKeptForTransactions,
            photosDeleted: result.photosDeleted,
            offersDeleted: result.offersDeleted,
            decksDeleted: result.decksDeleted,
            couponsDeleted: result.couponsDeleted,
            storageObjectsPendingDeletion: pendingStorage,
          },
          true,
        ),
      };
    }

    if (dto.type === 'RECTIFICATION') {
      let fields: string[];
      try {
        fields = await this.users.rectifyProfile(actor.id, dto.rectification!);
      } catch (err) {
        if (err instanceof ConflictException) {
          return { request: await deny('EMAIL_IN_USE') };
        }
        throw err;
      }
      if (fields.length === 0)
        return { request: await deny('NOTHING_TO_RECTIFY') };
      return {
        request: await this.finish(
          actor,
          profile,
          req,
          'FULFILLED',
          { fields },
          true,
        ),
      };
    }

    // ACCESS — the export is built, returned once and never stored.
    const data = await this.requests.collectExport(actor.id);
    const request = await this.finish(
      actor,
      profile,
      req,
      'FULFILLED',
      {
        sections: Object.keys(data),
      },
      true,
    );
    return {
      request,
      export: {
        format: EXPORT_FORMAT,
        version: EXPORT_VERSION,
        generatedAt: new Date(),
        requestId: req.id,
        ...data,
        processing: PROCESSING_INFO,
        notIncluded: NOT_INCLUDED,
      },
    };
  }

  async listMine(userId: string): Promise<RequestView[]> {
    return (await this.requests.findForUser(userId)).map((r) => this.toView(r));
  }

  async findMine(userId: string, id: string): Promise<RequestView> {
    // Scoped by owner in the query itself: someone else's request id is a 404,
    // indistinguishable from one that doesn't exist.
    const r = await this.requests.findOneForUser(id, userId);
    if (!r) throw new NotFoundException('Request not found');
    return this.toView(r);
  }

  /** SUPPORT/ADMIN follow-up (Permission.DATA_REQUESTS_READ): deadlines, never contents or identities. */
  async listForStaff(actor: RequestUser, status?: RequestStatus) {
    await this.audit.record({
      actorId: actor.id,
      actorRole: actor.role,
      action: 'admin.data-rights.list',
      outcome: 'ALLOWED',
    });
    const now = Date.now();
    return (await this.requests.list(status, 200)).map((r) => ({
      id: r.id,
      subjectPseudonym: this.audit.pseudonymOf(r.userId),
      type: r.type,
      status: r.status,
      outcome: r.outcome,
      reason: (r.details?.reason as string | undefined) ?? null,
      receivedAt: r.receivedAt,
      closedAt: r.closedAt,
      dueAt: r.dueAt,
      overdue: r.status !== 'CLOSED' && r.dueAt.getTime() < now,
    }));
  }

  // 5. Closing: record, audit, written answer.
  private async finish(
    actor: RequestUser,
    profile: { email: string; displayName: string },
    req: RightsRequestEntity,
    outcome: 'FULFILLED' | 'DENIED',
    details: Record<string, unknown>,
    executed: boolean,
  ): Promise<RequestView> {
    const closed = await this.requests.close(
      req.id,
      outcome,
      details,
      executed,
    );
    const reason = details.reason as DenialReason | undefined;
    await this.audit.record({
      actorId: actor.id,
      actorRole: actor.role,
      action: AUDIT_ACTION[req.type],
      targetId: actor.id,
      resourceType: 'data-rights-request',
      resourceRef: req.id,
      // Field names / erasure mode / denial code — never values.
      reason:
        reason ??
        (Array.isArray(details.fields)
          ? (details.fields as string[]).join(',')
          : (details.mode as string | undefined)),
      outcome: outcome === 'FULFILLED' ? 'ALLOWED' : 'DENIED',
    });
    this.events.emit(
      DATA_RIGHTS_CLOSED_EVENT,
      new DataRightsClosedEvent(
        profile.email,
        profile.displayName,
        req.id,
        req.type,
        outcome,
        reason ? DENIAL_MESSAGES[reason] : null,
      ),
    );
    return this.toView(closed);
  }

  /**
   * Photo objects live in S3/MinIO, outside the DB transaction. Best effort
   * after the commit: a failure is counted (and logged without keys) so the
   * request records that something is still pending, rather than failing
   * an erasure that already happened in the database.
   */
  private async deleteObjects(keys: string[]): Promise<number> {
    let pending = 0;
    for (const key of keys) {
      try {
        await this.storage.delete(key);
      } catch {
        pending++;
      }
    }
    if (pending > 0) {
      this.logger.warn(
        `erasure: ${pending} storage object(s) could not be deleted yet`,
      );
    }
    return pending;
  }

  private toView(r: RightsRequestEntity): RequestView {
    const reason = r.details?.reason as DenialReason | undefined;
    return {
      id: r.id,
      type: r.type,
      status: r.status,
      outcome: r.outcome,
      message: reason ? DENIAL_MESSAGES[reason] : null,
      verificationMethod: r.verificationMethod,
      details: r.details,
      receivedAt: r.receivedAt,
      verifiedAt: r.verifiedAt,
      evaluatedAt: r.evaluatedAt,
      executedAt: r.executedAt,
      closedAt: r.closedAt,
      dueAt: r.dueAt,
    };
  }
}
