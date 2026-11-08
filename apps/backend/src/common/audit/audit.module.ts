import { Global, Module } from '@nestjs/common';
import { APP_INTERCEPTOR } from '@nestjs/core';
import { PermissionsGuard } from '../auth/permissions.guard';
import { AuditService } from './audit.service';
import { AuditAccessInterceptor } from './audit-access.interceptor';

/**
 * Global so PermissionsGuard (which records denied attempts) can be used in
 * any module's controller without that module importing this one.
 */
@Global()
@Module({
  providers: [
    AuditService,
    PermissionsGuard,
    // O17: access logging for routes marked @AuditAccess (no-op elsewhere).
    { provide: APP_INTERCEPTOR, useClass: AuditAccessInterceptor },
  ],
  exports: [AuditService, PermissionsGuard],
})
export class AuditModule {}
