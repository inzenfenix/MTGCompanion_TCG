import { Global, Module } from '@nestjs/common';
import { PermissionsGuard } from '../auth/permissions.guard';
import { AuditService } from './audit.service';

/**
 * Global so PermissionsGuard (which records denied attempts) can be used in
 * any module's controller without that module importing this one.
 */
@Global()
@Module({
  providers: [AuditService, PermissionsGuard],
  exports: [AuditService, PermissionsGuard],
})
export class AuditModule {}
