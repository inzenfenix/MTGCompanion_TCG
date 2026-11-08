import { createHash, randomBytes } from 'node:crypto';
import {
  BadRequestException,
  ConflictException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { AuthService } from '../../auth/application/auth.service';
import type { RequestUser } from '../../auth/presentation/jwt.strategy';
import {
  ANONYMOUS_ACTOR,
  AuditService,
  SYSTEM_ACTOR,
} from '../../common/audit/audit.service';
import type { Role } from '../../common/auth/permissions';
import {
  DATA_RIGHTS_CLOSED_EVENT,
  DataRightsClosedEvent,
} from '../../common/events/data-rights-closed.event';
import {
  RIGHTS_CONFIRMATION_EVENT,
  RightsConfirmationEvent,
} from '../../common/events/rights-confirmation.event';
import { PseudonymService } from '../../common/privacy/pseudonym.service';
import { ProcessingControlService } from '../../processing-control/application/processing-control.service';
import type { ProcessingControlEntity } from '../../processing-control/domain/processing-control.repository';
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
  OBJECTION_PURPOSES,
  isObjectionPurpose,
  type ObjectionPurposeCode,
} from '../domain/objection-purposes';
import {
  BLOCKING_COVERS,
  BLOCKING_NOT_COVERED,
} from '../domain/blocking-scope';
import {
  COMPLETION_TTL_MS,
  CONFIRMATION_TTL_MS,
  DENIAL_MESSAGES,
  PUBLIC_REQUESTS_PER_DAY,
  blockingDenial,
  dueDateFor,
  erasureBlockers,
  erasureMode,
  mailboxProofSuffices,
  requiresStepUp,
  type BlockingBasis,
  type DenialReason,
  type RightsType,
} from '../domain/rights-policy';
import type {
  CompleteRightsRequestDto,
  CreateRightsRequestDto,
  PublicRightsRequestDto,
  RectificationDto,
} from '../presentation/dto/create-rights-request.dto';

export interface RequestView {
  id: string;
  type: RightsType;
  status: RequestStatus;
  outcome: 'FULFILLED' | 'DENIED' | null;
  message: string | null;
  channel: 'APP' | 'EMAIL_FORM';
  scope: string | null;
  relatedRequestId: string | null;
  verificationMethod: string | null;
  details: Record<string, unknown> | null;
  receivedAt: Date;
  verifiedAt: Date | null;
  evaluatedAt: Date | null;
  executedAt: Date | null;
  closedAt: Date | null;
  dueAt: Date;
  /** Public-form requests: deadline for the holder's next step. */
  expiresAt: Date | null;
}

/** Who acts on a request: the holder (session or mailbox proof) or the system (expiry). */
interface Actor {
  id: string;
  role: Role | null;
}
interface Profile {
  email: string;
  displayName: string;
}
/** What the execution step needs besides the stored request. */
interface ExecInput {
  rectification?: RectificationDto;
}

const AUDIT_ACTION: Record<RightsType, string> = {
  ACCESS: 'data.export',
  RECTIFICATION: 'data.rectify',
  ERASURE: 'data.erase',
  OBJECTION: 'data.object',
  BLOCKING: 'data.block',
};

const CONTACT_SCOPE = 'rights-contact';
const SWEEP_INTERVAL_MS = 60 * 60 * 1000;
const PUBLIC_ACK =
  'Recibimos tu solicitud. Si el correo corresponde a una cuenta, te enviamos un código para confirmarla; ' +
  'si no, te escribimos para informarte que no tratamos datos asociados a él. Revisa tu bandeja de entrada.';

const sha256 = (s: string) => createHash('sha256').update(s).digest('hex');

/**
 * Data-subject rights (ROADMAP.md O15, ACTIVIDAD_5.md §2; O16,
 * ACTIVIDAD_6.md). Every request, whatever its type and channel, walks the
 * same recorded lifecycle:
 *
 *  (public form) AWAITING_CONFIRMATION ─► PENDING_STEP_UP ─┐
 *                        │ (mailbox proof)        (step-up)│
 *                        ▼                                 ▼
 *   (app) RECEIVED ─► VERIFIED ─► IN_EVALUATION ─► (execution) ─► CLOSED FULFILLED
 *            │            │              │                          │
 *            └────────────┴──────────────┴─────────────────────► CLOSED DENIED + reason
 *
 * Reception = the row (with its legal deadline); verification = the
 * session, plus a single-use step-up for the risky cases, or the emailed
 * single-use code for the public form (rights-policy.ts); evaluation = the
 * business rules; execution = export / update / erasure / objection /
 * blocking; closing = the answer, recorded here, audited and emailed. Every
 * query is scoped to the holder's own account — no route or body takes a
 * user id.
 */
@Injectable()
export class DataRightsService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(DataRightsService.name);
  private sweepTimer?: NodeJS.Timeout;

  constructor(
    @Inject(DATA_RIGHTS_REPOSITORY)
    private readonly requests: DataRightsRepository,
    private readonly auth: AuthService,
    private readonly users: UsersService,
    private readonly audit: AuditService,
    private readonly storage: StorageService,
    private readonly events: EventEmitter2,
    private readonly controls: ProcessingControlService,
    private readonly pseudonyms: PseudonymService,
  ) {}

  // Public-form requests the holder never confirmed/completed are closed
  // here, hourly (no scheduler dependency in this app — a plain timer that
  // doesn't keep the process alive).
  onModuleInit() {
    this.sweepTimer = setInterval(() => {
      this.expireStale().catch((err: unknown) =>
        this.logger.error('rights sweep failed', err as Error),
      );
    }, SWEEP_INTERVAL_MS);
    this.sweepTimer.unref();
  }

  onModuleDestroy() {
    if (this.sweepTimer) clearInterval(this.sweepTimer);
  }

  // ── In-app channel ───────────────────────────────────────────────────

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
    const req = await this.requests.create({
      userId: actor.id,
      type: dto.type,
      channel: 'APP',
      receivedAt: now,
      dueAt: dueDateFor(now, dto.type),
      scope:
        dto.type === 'OBJECTION'
          ? dto.purpose
          : dto.type === 'BLOCKING'
            ? dto.blocking?.basis
            : null,
      statement: dto.statement ?? null,
      relatedRequestId: dto.blocking?.relatedRequestId ?? null,
    });
    const deny = (reason: DenialReason) =>
      this.finish(actor, profile, req, 'DENIED', { reason }, false);

    // 2. Verification
    const rectifiedFields = this.rectifiedFields(dto.rectification);
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

    return this.evaluateAndExecute(actor, profile, req, {
      rectification: dto.rectification,
    });
  }

  /**
   * O16 — finish, in the app, a public-form request whose type needs more
   * than the mailbox proof (rights-policy.ts mailboxProofSuffices). The
   * request keeps its id, reception date and deadline; only the
   * verification is upgraded.
   */
  async complete(
    actor: RequestUser,
    id: string,
    dto: CompleteRightsRequestDto,
  ): Promise<{ request: RequestView; export?: Record<string, unknown> }> {
    const req = await this.requests.findOneForUser(id, actor.id);
    if (!req) throw new NotFoundException('Request not found');
    if (req.status !== 'PENDING_STEP_UP') {
      throw new ConflictException(
        'This request is not waiting to be completed',
      );
    }
    if (req.type === 'RECTIFICATION' && !dto.rectification) {
      throw new BadRequestException('rectification is required');
    }
    if (req.type === 'ERASURE' && dto.confirmErasure !== true) {
      throw new BadRequestException('Erasure must be explicitly confirmed');
    }
    const profile = await this.users.findById(actor.id);
    if (!profile) throw new NotFoundException('User not found');
    const deny = (reason: DenialReason) =>
      this.finish(actor, profile, req, 'DENIED', { reason }, false);

    let method = `${req.verificationMethod ?? 'email-link'}+session`;
    let jti: string | null = null;
    if (requiresStepUp(req.type, this.rectifiedFields(dto.rectification))) {
      const stepUp = this.auth.checkStepUp(dto.stepUpToken, actor.id);
      if (!stepUp) return { request: await deny('IDENTITY_NOT_VERIFIED') };
      method = `${req.verificationMethod ?? 'email-link'}+${stepUp.method}`;
      jti = stepUp.jti;
    }
    try {
      await this.requests.markVerified(req.id, method, jti);
    } catch {
      return { request: await deny('STEP_UP_REUSED') };
    }
    return this.evaluateAndExecute(actor, profile, req, {
      rectification: dto.rectification,
    });
  }

  // ── Public channel (O16, ACTIVIDAD_6.md §1) ──────────────────────────

  /**
   * POST /data-rights/public-requests — no session. Always the same answer,
   * so the form can't be used to find out whether an address has an
   * account; the outcome goes to the mailbox, which only its owner reads.
   */
  async submitPublic(
    dto: PublicRightsRequestDto,
  ): Promise<{ received: true; message: string }> {
    const ack = { received: true as const, message: PUBLIC_ACK };
    if (dto.requestBlocking && dto.type === 'ACCESS') {
      throw new BadRequestException(
        'Blocking can only accompany a rectification, erasure or objection (art. 8 ter)',
      );
    }
    const email = dto.email.trim();
    const contact = this.pseudonyms.pseudonymize(
      email.toLowerCase(),
      CONTACT_SCOPE,
    );
    const now = new Date();

    // Each submission emails the address: cap it so the form can't be used
    // to flood someone's inbox. Over the cap: nothing stored, nothing sent.
    const recent = await this.requests.countPublicSince(
      contact,
      new Date(now.getTime() - 24 * 60 * 60 * 1000),
    );
    if (recent >= PUBLIC_REQUESTS_PER_DAY) {
      await this.audit.record({
        actorId: ANONYMOUS_ACTOR,
        actorRole: null,
        action: 'data.public-request',
        resourceType: 'data-rights-request',
        reason: 'throttled',
        outcome: 'DENIED',
      });
      return ack;
    }

    const base = {
      type: dto.type,
      channel: 'EMAIL_FORM' as const,
      receivedAt: now,
      dueAt: dueDateFor(now, dto.type),
      scope: dto.type === 'OBJECTION' ? dto.purpose : null,
      statement: dto.statement ?? null,
      requestBlocking: dto.requestBlocking ?? false,
      contactPseudonym: contact,
    };

    const account = await this.users.findAccountByEmail(email);
    if (!account) {
      // No account → no personal data tied to this address. Answered and
      // closed at once (art. 11 asks for an answer and proof of it), to the
      // address itself; the row keeps only the pseudonym.
      const req = await this.requests.create({ ...base, userId: null });
      await this.finish(
        null,
        { email, displayName: '' },
        req,
        'DENIED',
        { reason: 'NO_ACCOUNT' },
        false,
      );
      return ack;
    }

    const code = randomBytes(32).toString('base64url');
    const expiresAt = new Date(now.getTime() + CONFIRMATION_TTL_MS);
    const req = await this.requests.create({
      ...base,
      userId: account.id,
      status: 'AWAITING_CONFIRMATION',
      confirmTokenHash: sha256(code),
      expiresAt,
    });
    await this.audit.record({
      actorId: ANONYMOUS_ACTOR,
      actorRole: null,
      action: 'data.public-request',
      targetId: account.id,
      resourceType: 'data-rights-request',
      resourceRef: req.id,
      reason: `received:${dto.type}`,
      outcome: 'ALLOWED',
    });
    this.events.emit(
      RIGHTS_CONFIRMATION_EVENT,
      new RightsConfirmationEvent(
        account.email,
        account.displayName,
        req.id,
        dto.type,
        code,
        expiresAt,
      ),
    );
    return ack;
  }

  /**
   * POST /data-rights/public-requests/confirm — the code from the email.
   * Single use, 24 h. Proves control of the mailbox; what that is enough
   * for is decided by rights-policy.ts (objection: execute; the rest:
   * PENDING_STEP_UP until the holder completes it in the app).
   */
  async confirmPublic(code: string): Promise<{
    request: RequestView;
    next: 'DONE' | 'COMPLETE_IN_APP';
    blocking?: RequestView;
  }> {
    const hash = sha256(code.trim());
    const req = await this.requests.findByConfirmHash(hash);
    // Same answer for "never existed" and "already used": a code guess
    // learns nothing.
    if (!req || req.status !== 'AWAITING_CONFIRMATION' || !req.userId) {
      throw new BadRequestException('Invalid or already used code');
    }
    const user = await this.users.findById(req.userId);
    const actor: Actor = user
      ? { id: user.id, role: user.role }
      : { id: SYSTEM_ACTOR, role: null };
    const now = new Date();

    if (!user || (req.expiresAt && req.expiresAt < now)) {
      if (!(await this.requests.consumeConfirmation(req.id, hash))) {
        throw new BadRequestException('Invalid or already used code');
      }
      return {
        request: await this.finish(
          actor,
          user,
          req,
          'DENIED',
          { reason: user ? 'CONFIRMATION_EXPIRED' : 'NO_ACCOUNT' },
          false,
        ),
        next: 'DONE',
      };
    }
    if (!(await this.requests.consumeConfirmation(req.id, hash))) {
      throw new BadRequestException('Invalid or already used code');
    }
    await this.audit.record({
      actorId: user.id,
      actorRole: user.role,
      action: 'data.public-request.confirm',
      targetId: user.id,
      resourceType: 'data-rights-request',
      resourceRef: req.id,
      reason: 'email-link',
      outcome: 'ALLOWED',
    });

    if (mailboxProofSuffices(req.type)) {
      const { request } = await this.runVerified(actor, user, req, {});
      return { request, next: 'DONE' };
    }

    // Needs the step-up: park it, with its own deadline (never past the
    // legal one), and grant the blocking now if the holder asked for it —
    // that is exactly the "while it is resolved" case of art. 11.
    const completeBy = new Date(
      Math.min(now.getTime() + COMPLETION_TTL_MS, req.dueAt.getTime()),
    );
    const parked = await this.requests.setPendingStepUp(req.id, completeBy);
    let blocking: RequestView | undefined;
    if (req.requestBlocking) {
      blocking = await this.blockWhilePending(actor, user, parked);
    }
    this.events.emit(
      DATA_RIGHTS_CLOSED_EVENT,
      new DataRightsClosedEvent(
        user.email,
        user.displayName,
        parked.id,
        parked.type,
        'FULFILLED',
        null,
        null,
        true,
      ),
    );
    return { request: this.toView(parked), next: 'COMPLETE_IN_APP', blocking };
  }

  // ── Processing controls (O16, ACTIVIDAD_6.md §6) ─────────────────────

  /** GET /data-rights/controls — what can be objected to, and what is in force now. */
  async controlsFor(userId: string) {
    const history = await this.controls.history(userId);
    const active = history.filter((c) => c.status === 'ACTIVE');
    const blocking = active.find((c) => c.kind === 'BLOCKING') ?? null;
    return {
      objections: Object.values(OBJECTION_PURPOSES).map((p) => {
        const c = active.find(
          (a) => a.kind === 'OBJECTION' && a.scope === p.code,
        );
        return {
          ...p,
          active: !!c,
          since: c?.createdAt ?? null,
        };
      }),
      blocking: {
        active: !!blocking,
        basis: blocking?.basis ?? null,
        relatedRequestId: blocking?.relatedRequestId ?? null,
        since: blocking?.createdAt ?? null,
        covers: BLOCKING_COVERS,
        notCovered: BLOCKING_NOT_COVERED,
      },
      history: history.map((c) => this.controlView(c)),
    };
  }

  /** DELETE /data-rights/controls/objections/:purpose — the holder withdraws it. */
  async withdrawObjection(actor: RequestUser, purpose: string) {
    if (!isObjectionPurpose(purpose)) {
      throw new NotFoundException('Unknown purpose');
    }
    const c = await this.controls.activeObjection(actor.id, purpose);
    if (!c) throw new NotFoundException('No active objection for this purpose');
    const lifted = await this.controls.lift(c, 'HOLDER_WITHDREW');
    await this.auditControl(actor, 'data.objection.withdraw', lifted);
    return this.controlView(lifted);
  }

  /** DELETE /data-rights/controls/blocking — the holder lifts their own blocking. */
  async liftBlocking(actor: RequestUser) {
    const c = await this.controls.activeBlocking(actor.id);
    if (!c) throw new NotFoundException('No active blocking');
    const lifted = await this.controls.lift(c, 'HOLDER_WITHDREW');
    await this.auditControl(actor, 'data.blocking.lift', lifted);
    return this.controlView(lifted);
  }

  // ── Follow-up ────────────────────────────────────────────────────────

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
      subjectPseudonym: r.userId ? this.audit.pseudonymOf(r.userId) : null,
      type: r.type,
      channel: r.channel,
      scope: r.scope,
      status: r.status,
      outcome: r.outcome,
      reason: (r.details?.reason as string | undefined) ?? null,
      receivedAt: r.receivedAt,
      closedAt: r.closedAt,
      dueAt: r.dueAt,
      overdue: r.status !== 'CLOSED' && r.dueAt.getTime() < now,
    }));
  }

  /**
   * Closes public-form requests whose holder step expired: unconfirmed
   * after 24 h, or confirmed but not completed in the app in 14 days. An
   * unconfirmed one is closed without emailing (the confirmation email
   * already said it would lapse, and a second email to an address someone
   * else typed in would only add noise); a confirmed one gets its written
   * answer like any other. Any blocking tied to it is lifted by finish().
   */
  async expireStale(now: Date = new Date()): Promise<number> {
    const stale = await this.requests.findExpiredOpen(now);
    for (const req of stale) {
      const user = req.userId ? await this.users.findById(req.userId) : null;
      await this.finish(
        { id: SYSTEM_ACTOR, role: null },
        user,
        req,
        'DENIED',
        { reason: 'CONFIRMATION_EXPIRED' },
        false,
        req.status === 'PENDING_STEP_UP',
      );
    }
    return stale.length;
  }

  // ── Pipeline ─────────────────────────────────────────────────────────

  /** For a request whose identity check just passed (mailbox proof). */
  private async runVerified(
    actor: Actor,
    profile: Profile,
    req: RightsRequestEntity,
    input: ExecInput,
  ) {
    await this.requests.markVerified(
      req.id,
      req.verificationMethod ?? 'email-link',
      null,
    );
    return this.evaluateAndExecute(actor, profile, req, input);
  }

  private async evaluateAndExecute(
    actor: Actor,
    profile: Profile,
    req: RightsRequestEntity,
    input: ExecInput,
  ): Promise<{ request: RequestView; export?: Record<string, unknown> }> {
    const userId = req.userId!;
    const deny = (reason: DenialReason, extra: Record<string, unknown> = {}) =>
      this.finish(actor, profile, req, 'DENIED', { reason, ...extra }, false);

    // 3. Evaluation
    await this.requests.markInEvaluation(req.id);

    if (req.type === 'ERASURE') {
      const facts = await this.requests.erasureFacts(userId);
      const blockers = erasureBlockers(facts);
      if (blockers.length > 0) return { request: await deny(blockers[0]) };

      // 4. Execution
      const result = await this.requests.erase(
        userId,
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

    if (req.type === 'RECTIFICATION') {
      let fields: string[];
      try {
        fields = await this.users.rectifyProfile(userId, input.rectification!);
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

    if (req.type === 'OBJECTION') {
      const purpose = req.scope as ObjectionPurposeCode;
      const def = OBJECTION_PURPOSES[purpose];
      if (def.decision === 'DENY') {
        // Art. 8 a + art. 11: a grounded denial, with the grounds.
        return {
          request: await deny('COMPELLING_GROUNDS', {
            purpose,
            grounds: def.effect,
          }),
        };
      }
      const created = await this.controls.objectTo(userId, purpose, req.id);
      return {
        request: await this.finish(
          actor,
          profile,
          req,
          'FULFILLED',
          { purpose, alreadyActive: !created, effect: def.effect },
          true,
        ),
      };
    }

    if (req.type === 'BLOCKING') {
      const basis = req.scope as BlockingBasis;
      const related =
        basis === 'PENDING_REQUEST' && req.relatedRequestId
          ? await this.requests.findOneForUser(req.relatedRequestId, userId)
          : null;
      const denial = blockingDenial(basis, related);
      if (denial) return { request: await deny(denial) };
      const created = await this.controls.block(
        userId,
        basis,
        req.id,
        related?.id,
      );
      return {
        request: await this.finish(
          actor,
          profile,
          req,
          'FULFILLED',
          {
            basis,
            relatedRequestId: related?.id ?? null,
            alreadyActive: !created,
            covers: BLOCKING_COVERS.map((c) => c.what),
            effect:
              'Mientras dure el bloqueo tus publicaciones no aparecen en el Bazar, no reciben ofertas ni compras nuevas, ' +
              'no guardamos tu ubicación, no te enviamos correos opcionales y tus ventas no entran en las estadísticas. ' +
              'Tus datos se siguen almacenando, sin cambios.',
          },
          true,
        ),
      };
    }

    // ACCESS — the export is built, returned once and never stored.
    const data = await this.requests.collectExport(userId);
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

  /**
   * Art. 11: "Cuando se formule una solicitud de rectificación, supresión u
   * oposición, el titular tendrá derecho a solicitar y obtener … el
   * bloqueo temporal". Recorded as its own BLOCKING request (own 2-business-
   * day deadline, own answer), tied to the pending one.
   */
  private async blockWhilePending(
    actor: Actor,
    profile: Profile,
    pending: RightsRequestEntity,
  ): Promise<RequestView> {
    const now = new Date();
    const req = await this.requests.create({
      userId: pending.userId,
      type: 'BLOCKING',
      channel: pending.channel,
      receivedAt: now,
      dueAt: dueDateFor(now, 'BLOCKING'),
      scope: 'PENDING_REQUEST',
      relatedRequestId: pending.id,
      statement:
        pending.statement ??
        `Pedido junto con la solicitud ${pending.id} en el formulario público.`,
    });
    const { request } = await this.runVerified(actor, profile, req, {});
    return request;
  }

  // 5. Closing: record, audit, written answer — and lift any blocking that
  // was only meant to last while this request was open (art. 11).
  private async finish(
    actor: Actor | null,
    profile: Profile | null,
    req: RightsRequestEntity,
    outcome: 'FULFILLED' | 'DENIED',
    details: Record<string, unknown>,
    executed: boolean,
    notify = true,
  ): Promise<RequestView> {
    const closed = await this.requests.close(
      req.id,
      outcome,
      details,
      executed,
    );
    const reason = details.reason as DenialReason | undefined;
    await this.audit.record({
      actorId: actor?.id ?? ANONYMOUS_ACTOR,
      actorRole: actor?.role ?? null,
      action: AUDIT_ACTION[req.type],
      targetId: req.userId ?? undefined,
      resourceType: 'data-rights-request',
      resourceRef: req.id,
      // Field names / erasure mode / purpose / denial code — never values.
      reason:
        reason ??
        (Array.isArray(details.fields)
          ? (details.fields as string[]).join(',')
          : ((details.mode ?? details.purpose ?? details.basis) as
              string | undefined)),
      outcome: outcome === 'FULFILLED' ? 'ALLOWED' : 'DENIED',
    });

    for (const lifted of await this.controls.liftForClosedRequest(req.id)) {
      await this.auditControl(actor, 'data.blocking.lift', lifted);
    }

    if (notify && profile) {
      this.events.emit(
        DATA_RIGHTS_CLOSED_EVENT,
        new DataRightsClosedEvent(
          profile.email,
          profile.displayName,
          req.id,
          req.type,
          outcome,
          this.messageFor(details),
          (details.effect as string | undefined) ?? null,
        ),
      );
    }
    return this.toView(closed);
  }

  private async auditControl(
    actor: Actor | null,
    action: string,
    c: ProcessingControlEntity,
  ) {
    await this.audit.record({
      actorId: actor?.id ?? SYSTEM_ACTOR,
      actorRole: actor?.role ?? null,
      action,
      targetId: c.userId,
      resourceType: 'processing-control',
      resourceRef: c.id,
      reason: `${c.kind}:${c.scope}:${c.liftReason ?? ''}`,
      outcome: 'ALLOWED',
    });
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

  private rectifiedFields(r?: RectificationDto): string[] {
    return Object.entries(r ?? {})
      .filter(([, v]) => v !== undefined)
      .map(([k]) => k);
  }

  private messageFor(details: Record<string, unknown> | null): string | null {
    if (!details) return null;
    if (typeof details.grounds === 'string') return details.grounds;
    const reason = details.reason as DenialReason | undefined;
    return reason ? DENIAL_MESSAGES[reason] : null;
  }

  private controlView(c: ProcessingControlEntity) {
    return {
      kind: c.kind,
      scope: c.scope,
      basis: c.basis,
      status: c.status,
      requestId: c.requestId,
      relatedRequestId: c.relatedRequestId,
      since: c.createdAt,
      liftedAt: c.liftedAt,
      liftReason: c.liftReason,
    };
  }

  private toView(r: RightsRequestEntity): RequestView {
    return {
      id: r.id,
      type: r.type,
      status: r.status,
      outcome: r.outcome,
      message: this.messageFor(r.details),
      channel: r.channel,
      scope: r.scope,
      relatedRequestId: r.relatedRequestId,
      verificationMethod: r.verificationMethod,
      details: r.details,
      receivedAt: r.receivedAt,
      verifiedAt: r.verifiedAt,
      evaluatedAt: r.evaluatedAt,
      executedAt: r.executedAt,
      closedAt: r.closedAt,
      dueAt: r.dueAt,
      expiresAt: r.expiresAt,
    };
  }
}
