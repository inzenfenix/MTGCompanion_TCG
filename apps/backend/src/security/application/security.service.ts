import {
  BadRequestException,
  ConflictException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { OnEvent } from '@nestjs/event-emitter';
import type { RequestUser } from '../../auth/presentation/jwt.strategy';
import { AuditService, SYSTEM_ACTOR } from '../../common/audit/audit.service';
import type { ChainVerification } from '../../common/audit/audit-chain';
import {
  AUDIT_RECORDED_EVENT,
  AuditRecordedEvent,
} from '../../common/events/audit-recorded.event';
import type { AppConfig } from '../../config/configuration';
import { NotificationsService } from '../../notifications/notifications.service';
import { UsersService } from '../../users/application/users.service';
import {
  ANONYMOUS,
  AUDIT_CHAIN_RULE,
  DETECTION_RULES,
  LOCK_MINUTES,
  canTransition,
  type AlertStatus,
  type DetectionRule,
  type Severity,
} from '../domain/detection-rules';
import {
  SECURITY_REPOSITORY,
  type SecurityAlertEntity,
  type SecurityRepository,
} from '../domain/security.repository';

const MINUTE = 60_000;

/**
 * Detection + containment (ROADMAP.md O15, ACTIVIDAD_5.md §4–5).
 *
 * Detection runs on every audit row (AUDIT_RECORDED_EVENT, awaited by
 * AuditService), so nothing has to remember to call it. Containment comes
 * in two tiers: an automatic first step tied to the rule (lock the account
 * for 15 min, or kill every session) — reversible and proportionate — and
 * the manual tools of the incident plan for an ADMIN (revoke sessions,
 * disable/enable an account), each one requiring a reason and audited.
 * None of them delete data: evidence is preserved by design.
 */
@Injectable()
export class SecurityService {
  private readonly logger = new Logger(SecurityService.name);

  constructor(
    @Inject(SECURITY_REPOSITORY) private readonly alerts: SecurityRepository,
    private readonly audit: AuditService,
    private readonly users: UsersService,
    private readonly notifications: NotificationsService,
    private readonly config: ConfigService<AppConfig, true>,
  ) {}

  @OnEvent(AUDIT_RECORDED_EVENT)
  async onAuditRecorded(event: AuditRecordedEvent): Promise<void> {
    for (const rule of DETECTION_RULES) {
      if (rule.matches(event)) await this.evaluate(rule, event);
    }
  }

  private async evaluate(rule: DetectionRule, event: AuditRecordedEvent) {
    const since = new Date(Date.now() - rule.windowMinutes * MINUTE);
    const count = await this.alerts.countEvents(
      event.actorPseudonym,
      rule.count,
      since,
    );
    if (count < rule.threshold) return;
    const subject = event.actorPseudonym;
    // One alert per burst: while one is still open for this rule + subject
    // inside the window, further events don't pile up duplicates.
    if (await this.alerts.findActive(rule.id, subject, since)) return;

    const alert = await this.raise(
      rule.id,
      rule.severity,
      subject,
      {
        events: count,
        windowMinutes: rule.windowMinutes,
        threshold: rule.threshold,
        automaticContainment: rule.containment,
      },
      event.actorId === ANONYMOUS ? undefined : event.actorId,
    );

    if (event.actorId === ANONYMOUS) return;
    if (rule.containment === 'lock-account') {
      await this.users.lockUntil(
        event.actorId,
        new Date(Date.now() + LOCK_MINUTES * MINUTE),
      );
      await this.recordContainment(
        'security.containment.lock',
        event.actorId,
        alert.id,
      );
    } else if (rule.containment === 'revoke-sessions') {
      await this.users.revokeSessions(event.actorId);
      await this.recordContainment(
        'security.containment.revoke-sessions',
        event.actorId,
        alert.id,
      );
    }
  }

  private async raise(
    rule: string,
    severity: Severity,
    subjectPseudonym: string | null,
    details: Record<string, unknown>,
    subjectId?: string,
  ): Promise<SecurityAlertEntity> {
    const alert = await this.alerts.create({
      rule,
      severity,
      subjectPseudonym,
      details,
    });
    await this.audit.record({
      actorId: SYSTEM_ACTOR,
      actorRole: null,
      action: 'security.alert.raised',
      targetId: subjectId,
      resourceType: 'security-alert',
      resourceRef: alert.id,
      reason: `${rule} (${severity})`,
      outcome: 'ALLOWED',
    });
    this.logger.warn(`security alert ${alert.id}: ${rule} (${severity})`);
    const to = this.config.get('security', { infer: true }).alertEmail;
    if (to) {
      try {
        await this.notifications.sendSecurityAlertEmail(to, {
          alertId: alert.id,
          rule,
          severity,
        });
      } catch {
        this.logger.error(`could not email security alert ${alert.id}`);
      }
    }
    return alert;
  }

  private recordContainment(action: string, targetId: string, alertId: string) {
    return this.audit.record({
      actorId: SYSTEM_ACTOR,
      actorRole: null,
      action,
      targetId,
      resourceType: 'security-alert',
      resourceRef: alertId,
      outcome: 'ALLOWED',
    });
  }

  // ── ADMIN tools (Permission.INCIDENT_RESPONSE) ───────────────────────────

  listAlerts(status?: AlertStatus) {
    return this.alerts.list(status, 200);
  }

  /** Triage: OPEN → INVESTIGATING → CONFIRMED/DISMISSED → CLOSED, with a note. */
  async updateAlert(
    actor: RequestUser,
    id: string,
    status: AlertStatus,
    note: string,
  ) {
    const alert = await this.alerts.find(id);
    if (!alert) throw new NotFoundException('Alert not found');
    if (!canTransition(alert.status, status)) {
      throw new ConflictException(
        `Cannot go from ${alert.status} to ${status}`,
      );
    }
    const updated = await this.alerts.update(id, {
      status,
      resolutionNote: note,
      handledBy: this.audit.pseudonymOf(actor.id),
    });
    await this.audit.record({
      actorId: actor.id,
      actorRole: actor.role,
      action: 'security.alert.update',
      resourceType: 'security-alert',
      resourceRef: id,
      reason: `${alert.status} -> ${status}: ${note}`,
      outcome: 'ALLOWED',
    });
    return updated;
  }

  async revokeSessions(actor: RequestUser, targetId: string, reason: string) {
    await this.requireTarget(actor, targetId);
    await this.users.revokeSessions(targetId);
    await this.recordManual(
      actor,
      'security.containment.revoke-sessions',
      targetId,
      reason,
    );
    return { targetId, sessionsRevoked: true };
  }

  async setDisabled(
    actor: RequestUser,
    targetId: string,
    disabled: boolean,
    reason: string,
  ) {
    await this.requireTarget(actor, targetId);
    await this.users.setDisabled(targetId, disabled);
    // Re-enabling also lifts a brute-force lock: recovery is one step.
    if (!disabled) await this.users.lockUntil(targetId, null);
    await this.recordManual(
      actor,
      disabled ? 'security.containment.disable' : 'security.recovery.enable',
      targetId,
      reason,
    );
    return { targetId, disabled };
  }

  /** GET /admin/security/audit/verify — a broken chain is itself an alert. */
  async verifyAuditChain(actor: RequestUser): Promise<ChainVerification> {
    const result = await this.audit.verifyChain();
    await this.audit.record({
      actorId: actor.id,
      actorRole: actor.role,
      action: 'admin.audit.verify',
      reason: result.ok
        ? `ok (${result.checked} rows)`
        : `broken at seq ${result.brokenAt?.seq}`,
      outcome: 'ALLOWED',
    });
    if (
      !result.ok &&
      !(await this.alerts.findActive(AUDIT_CHAIN_RULE, null, new Date(0)))
    ) {
      await this.raise(AUDIT_CHAIN_RULE, 'HIGH', null, { ...result.brokenAt });
    }
    return result;
  }

  private async requireTarget(actor: RequestUser, targetId: string) {
    // An ADMIN can't lock themselves out (or "contain" their own account to
    // hide what it did) — another ADMIN has to.
    if (actor.id === targetId) {
      throw new BadRequestException(
        'You cannot apply containment to your own account',
      );
    }
    if (!(await this.users.findById(targetId))) {
      throw new NotFoundException('User not found');
    }
  }

  private recordManual(
    actor: RequestUser,
    action: string,
    targetId: string,
    reason: string,
  ) {
    return this.audit.record({
      actorId: actor.id,
      actorRole: actor.role,
      action,
      targetId,
      resourceType: 'user',
      reason,
      outcome: 'ALLOWED',
    });
  }
}
