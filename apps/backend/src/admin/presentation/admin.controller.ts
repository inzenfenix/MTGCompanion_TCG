import {
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { JwtAuthGuard } from '../../auth/presentation/jwt-auth.guard';
import { CurrentUser } from '../../auth/presentation/current-user.decorator';
import type { RequestUser } from '../../auth/presentation/jwt.strategy';
import { PermissionsGuard } from '../../common/auth/permissions.guard';
import { Permission } from '../../common/auth/permissions';
import { RequirePermissions } from '../../common/auth/require-permissions.decorator';
import { AdminService } from '../application/admin.service';
import {
  AccessReasonDto,
  ChangeRoleDto,
  LimitQueryDto,
  ResolvePseudonymDto,
} from './dto/admin.dto';

// ROADMAP.md O14 — every route here needs a session (JwtAuthGuard: 401
// without one) *and* the listed permission for the caller's role
// (PermissionsGuard: 403 otherwise, recorded in the audit log). The
// role → permission table is common/auth/permissions.ts.
@Controller('admin')
@UseGuards(JwtAuthGuard, PermissionsGuard)
export class AdminController {
  constructor(private readonly admin: AdminService) {}

  @Get('users')
  @RequirePermissions(Permission.USERS_LIST)
  listUsers(@Query() query: LimitQueryDto) {
    return this.admin.listUsers(query.limit);
  }

  @Patch('users/:id/role')
  @RequirePermissions(Permission.ROLES_MANAGE)
  changeRole(
    @CurrentUser() actor: RequestUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: ChangeRoleDto,
  ) {
    return this.admin.changeRole(actor, id, dto.role);
  }

  // ?reason= is mandatory (AccessReasonDto) — support doesn't browse, it
  // looks up one account for one stated purpose.
  @Get('users/:id/transactions')
  @RequirePermissions(Permission.TRANSACTIONS_READ_ANY)
  transactionsOf(
    @CurrentUser() actor: RequestUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Query() query: AccessReasonDto,
  ) {
    return this.admin.transactionsOf(actor, id, query.reason);
  }

  @Get('audit-logs')
  @RequirePermissions(Permission.AUDIT_READ)
  auditLog(@CurrentUser() actor: RequestUser, @Query() query: LimitQueryDto) {
    return this.admin.auditLog(actor, query.limit);
  }

  @Get('reports/sales')
  @RequirePermissions(Permission.REPORTS_READ)
  salesReport(@CurrentUser() actor: RequestUser) {
    return this.admin.salesReport(actor);
  }

  @Post('pseudonyms/resolve')
  @RequirePermissions(Permission.PSEUDONYM_RESOLVE)
  resolvePseudonym(
    @CurrentUser() actor: RequestUser,
    @Body() dto: ResolvePseudonymDto,
  ) {
    return this.admin.resolvePseudonym(actor, dto.pseudonym, dto.reason);
  }
}
