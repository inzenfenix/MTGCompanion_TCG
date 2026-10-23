import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import type { Role } from '../../common/auth/permissions';
import type {
  AdminRepository,
  AdminUserRow,
  SalesAggregateRow,
} from '../domain/admin.repository';

// Only the columns an admin screen needs — never passwordHash, never
// settings (2FA secret, location).
const ADMIN_USER_SELECT = {
  id: true,
  email: true,
  displayName: true,
  role: true,
  createdAt: true,
} as const;

@Injectable()
export class PrismaAdminRepository implements AdminRepository {
  constructor(private readonly prisma: PrismaService) {}

  listUsers(limit: number): Promise<AdminUserRow[]> {
    return this.prisma.user.findMany({
      select: ADMIN_USER_SELECT,
      orderBy: { createdAt: 'desc' },
      take: limit,
    });
  }

  findUser(id: string): Promise<AdminUserRow | null> {
    return this.prisma.user.findUnique({
      where: { id },
      select: ADMIN_USER_SELECT,
    });
  }

  async setRole(id: string, role: Role): Promise<void> {
    await this.prisma.user.update({ where: { id }, data: { role } });
  }

  async allUserIds(): Promise<string[]> {
    const rows = await this.prisma.user.findMany({ select: { id: true } });
    return rows.map((r) => r.id);
  }

  // Aggregation happens in SQL, so individual transaction rows never even
  // reach the application for this report.
  async paidSalesAggregates(): Promise<SalesAggregateRow[]> {
    return this.prisma.$queryRaw<SalesAggregateRow[]>`
      SELECT to_char(date_trunc('month', t."createdAt"), 'YYYY-MM') AS "month",
             c."condition"::text                   AS "condition",
             t."paymentMethod"::text               AS "paymentMethod",
             COUNT(*)::int                         AS "sales",
             SUM(t."amount")::float8               AS "total",
             COUNT(DISTINCT t."buyerId")::int      AS "distinctBuyers",
             COUNT(DISTINCT t."sellerId")::int     AS "distinctSellers"
        FROM "transactions" t
        JOIN "cards" c ON c."id" = t."cardId"
       WHERE t."status" = 'PAID'
       GROUP BY 1, 2, 3
       ORDER BY 1, 2, 3`;
  }
}
