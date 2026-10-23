import { Injectable } from '@nestjs/common';
import type { Prisma } from '../../../generated/prisma';
import { PrismaService } from '../../prisma/prisma.service';
import type {
  AlertStatus,
  DetectionRule,
  Severity,
} from '../domain/detection-rules';
import type {
  SecurityAlertEntity,
  SecurityRepository,
} from '../domain/security.repository';

type Row = Prisma.SecurityAlertGetPayload<object>;

@Injectable()
export class PrismaSecurityRepository implements SecurityRepository {
  constructor(private readonly prisma: PrismaService) {}

  private toEntity(row: Row): SecurityAlertEntity {
    return {
      ...row,
      details: (row.details as Record<string, unknown> | null) ?? null,
    };
  }

  countEvents(
    actorPseudonym: string,
    count: DetectionRule['count'],
    since: Date,
  ): Promise<number> {
    return this.prisma.auditLog.count({
      where: {
        actorPseudonym,
        action: count.prefix ? { startsWith: count.action } : count.action,
        ...(count.outcome ? { outcome: count.outcome } : {}),
        createdAt: { gte: since },
      },
    });
  }

  async findActive(rule: string, subjectPseudonym: string | null, since: Date) {
    const row = await this.prisma.securityAlert.findFirst({
      where: {
        rule,
        subjectPseudonym,
        status: { in: ['OPEN', 'INVESTIGATING'] },
        createdAt: { gte: since },
      },
    });
    return row ? this.toEntity(row) : null;
  }

  async create(data: {
    rule: string;
    severity: Severity;
    subjectPseudonym: string | null;
    details: Record<string, unknown>;
  }) {
    return this.toEntity(
      await this.prisma.securityAlert.create({
        data: { ...data, details: data.details as Prisma.InputJsonValue },
      }),
    );
  }

  async list(status?: AlertStatus, limit = 100) {
    const rows = await this.prisma.securityAlert.findMany({
      where: status ? { status } : {},
      orderBy: { createdAt: 'desc' },
      take: limit,
    });
    return rows.map((r) => this.toEntity(r));
  }

  async find(id: string) {
    const row = await this.prisma.securityAlert.findUnique({ where: { id } });
    return row ? this.toEntity(row) : null;
  }

  async update(
    id: string,
    data: { status: AlertStatus; resolutionNote: string; handledBy: string },
  ) {
    return this.toEntity(
      await this.prisma.securityAlert.update({ where: { id }, data }),
    );
  }
}
