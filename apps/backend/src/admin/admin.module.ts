import { Module } from '@nestjs/common';
import { TransactionsModule } from '../transactions/transactions.module';
import { ADMIN_REPOSITORY } from './domain/admin.repository';
import { PrismaAdminRepository } from './infrastructure/prisma-admin.repository';
import { AdminService } from './application/admin.service';
import { AdminController } from './presentation/admin.controller';

// ROADMAP.md O14 — RBAC-protected administrative/support operations.
// AuditService, PermissionsGuard and PseudonymService come from the global
// AuditModule/PrivacyModule.
@Module({
  imports: [TransactionsModule],
  controllers: [AdminController],
  providers: [
    { provide: ADMIN_REPOSITORY, useClass: PrismaAdminRepository },
    AdminService,
  ],
})
export class AdminModule {}
