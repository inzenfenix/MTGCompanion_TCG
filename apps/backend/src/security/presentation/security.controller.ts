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
import { SecurityService } from '../application/security.service';
import {
  AlertQueryDto,
  ContainmentDto,
  UpdateAlertDto,
} from './dto/security.dto';

// ROADMAP.md O15 — the technical procedures of the incident response plan
// (docs/security/ACTIVIDAD_5.md §4). ADMIN only, every call audited; a
// SUPPORT or USER token gets a 403 that PermissionsGuard also audits.
@Controller('admin/security')
@UseGuards(JwtAuthGuard, PermissionsGuard)
export class SecurityController {
  constructor(private readonly security: SecurityService) {}

  @Get('alerts')
  @RequirePermissions(Permission.INCIDENT_RESPONSE)
  alerts(@Query() query: AlertQueryDto) {
    return this.security.listAlerts(query.status);
  }

  @Patch('alerts/:id')
  @RequirePermissions(Permission.INCIDENT_RESPONSE)
  updateAlert(
    @CurrentUser() actor: RequestUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateAlertDto,
  ) {
    return this.security.updateAlert(actor, id, dto.status, dto.reason);
  }

  @Post('users/:id/revoke-sessions')
  @RequirePermissions(Permission.INCIDENT_RESPONSE)
  revokeSessions(
    @CurrentUser() actor: RequestUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: ContainmentDto,
  ) {
    return this.security.revokeSessions(actor, id, dto.reason);
  }

  @Post('users/:id/disable')
  @RequirePermissions(Permission.INCIDENT_RESPONSE)
  disable(
    @CurrentUser() actor: RequestUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: ContainmentDto,
  ) {
    return this.security.setDisabled(actor, id, true, dto.reason);
  }

  @Post('users/:id/enable')
  @RequirePermissions(Permission.INCIDENT_RESPONSE)
  enable(
    @CurrentUser() actor: RequestUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: ContainmentDto,
  ) {
    return this.security.setDisabled(actor, id, false, dto.reason);
  }

  @Get('audit/verify')
  @RequirePermissions(Permission.AUDIT_READ)
  verifyAudit(@CurrentUser() actor: RequestUser) {
    return this.security.verifyAuditChain(actor);
  }
}
