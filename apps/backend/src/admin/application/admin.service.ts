import {
  BadRequestException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  AuditService,
  type AuditEntry,
} from '../../common/audit/audit.service';
import type { Role } from '../../common/auth/permissions';
import {
  AUDIT_SCOPE,
  PseudonymService,
} from '../../common/privacy/pseudonym.service';
import { maskEmail } from '../../common/privacy/redact';
import type { RequestUser } from '../../auth/presentation/jwt.strategy';
import { TransactionsService } from '../../transactions/application/transactions.service';
import {
  ADMIN_REPOSITORY,
  type AdminRepository,
} from '../domain/admin.repository';
import {
  anonymizeSalesReport,
  type AnonymizedSalesReport,
} from '../domain/k-anonymity';

export interface AdminUserView {
  id: string;
  displayName: string;
  role: Role;
  /** Masked — no admin screen needs the full address (contact goes through the backend's own emails). */
  emailMasked: string;
  createdAt: Date;
}

/**
 * Administrative and support operations (ROADMAP.md O14,
 * docs/security/ACTIVIDAD_4.md §3). Who may call what is decided by
 * PermissionsGuard on the controller; this layer adds the rules a
 * permission alone can't express (no changing your own role, a reason for
 * every look at someone else's data) and writes the audit trail.
 */
@Injectable()
export class AdminService {
  constructor(
    @Inject(ADMIN_REPOSITORY) private readonly admin: AdminRepository,
    private readonly audit: AuditService,
    private readonly pseudonyms: PseudonymService,
    private readonly transactions: TransactionsService,
  ) {}

  async listUsers(limit = 100): Promise<AdminUserView[]> {
    const rows = await this.admin.listUsers(Math.min(limit, 500));
    return rows.map((u) => ({
      id: u.id,
      displayName: u.displayName,
      role: u.role,
      emailMasked: maskEmail(u.email),
      createdAt: u.createdAt,
    }));
  }

  async changeRole(
    actor: RequestUser,
    targetId: string,
    role: Role,
  ): Promise<AdminUserView> {
    // Separation of duties: nobody promotes (or, by mistake, demotes and
    // locks out) themselves — it takes a second ADMIN.
    if (actor.id === targetId) {
      throw new BadRequestException('You cannot change your own role');
    }
    const target = await this.admin.findUser(targetId);
    if (!target) throw new NotFoundException('User not found');

    await this.admin.setRole(targetId, role);
    await this.audit.record({
      actorId: actor.id,
      actorRole: actor.role,
      action: 'admin.role.change',
      targetId,
      reason: `${target.role} -> ${role}`,
      outcome: 'ALLOWED',
    });
    return {
      id: target.id,
      displayName: target.displayName,
      role,
      emailMasked: maskEmail(target.email),
      createdAt: target.createdAt,
    };
  }

  /** Dispute resolution: someone else's transactions, only with a stated reason, always audited. */
  async transactionsOf(actor: RequestUser, targetId: string, reason: string) {
    const target = await this.admin.findUser(targetId);
    if (!target) throw new NotFoundException('User not found');
    await this.audit.record({
      actorId: actor.id,
      actorRole: actor.role,
      action: 'support.transactions.read',
      targetId,
      reason,
      outcome: 'ALLOWED',
    });
    return this.transactions.findForUser(targetId);
  }

  async auditLog(actor: RequestUser, limit = 100): Promise<AuditEntry[]> {
    await this.audit.record({
      actorId: actor.id,
      actorRole: actor.role,
      action: 'admin.audit.read',
      outcome: 'ALLOWED',
    });
    return this.audit.list(Math.min(limit, 500));
  }

  async salesReport(actor: RequestUser): Promise<AnonymizedSalesReport> {
    await this.audit.record({
      actorId: actor.id,
      actorRole: actor.role,
      action: 'admin.reports.sales.read',
      outcome: 'ALLOWED',
    });
    return anonymizeSalesReport(await this.admin.paidSalesAggregates());
  }

  /**
   * Re-identification of an audit-log pseudonym — the one operation that
   * undoes the pseudonymization, so it's ADMIN-only (Permission
   * .PSEUDONYM_RESOLVE), requires a reason, and is itself audited (with the
   * resolved account as target, so the log shows *whose* identity was
   * looked up). Returns the account id and display name, not the email.
   */
  async resolvePseudonym(
    actor: RequestUser,
    pseudonym: string,
    reason: string,
  ) {
    const userId = this.pseudonyms.resolve(
      pseudonym,
      await this.admin.allUserIds(),
      AUDIT_SCOPE,
    );
    await this.audit.record({
      actorId: actor.id,
      actorRole: actor.role,
      action: 'admin.pseudonym.resolve',
      targetId: userId ?? undefined,
      reason,
      outcome: 'ALLOWED',
    });
    if (!userId)
      throw new NotFoundException('No account matches this pseudonym');
    const user = await this.admin.findUser(userId);
    return { userId, displayName: user?.displayName ?? null };
  }
}
