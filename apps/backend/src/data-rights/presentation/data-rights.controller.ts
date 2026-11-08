import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  ParseUUIDPipe,
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
import { DataRightsService } from '../application/data-rights.service';
import { OBJECTION_PURPOSES } from '../domain/objection-purposes';
import {
  CompleteRightsRequestDto,
  ConfirmPublicRequestDto,
  CreateRightsRequestDto,
  ListRequestsQueryDto,
  PublicRightsRequestDto,
} from './dto/create-rights-request.dto';

// ROADMAP.md O15 (ACTIVIDAD_5.md §2) + O16 (ACTIVIDAD_6.md). Self-service:
// the subject is always the authenticated account — no route takes a user id.
@Controller('data-rights/requests')
@UseGuards(JwtAuthGuard)
export class DataRightsController {
  constructor(private readonly rights: DataRightsService) {}

  @Post()
  submit(
    @CurrentUser() user: RequestUser,
    @Body() dto: CreateRightsRequestDto,
  ) {
    return this.rights.submit(user, dto);
  }

  @Get()
  mine(@CurrentUser() user: RequestUser) {
    return this.rights.listMine(user.id);
  }

  @Get(':id')
  one(
    @CurrentUser() user: RequestUser,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.rights.findMine(user.id, id);
  }

  // O16: a public-form request that needs the step-up, finished in the app.
  @Post(':id/complete')
  @HttpCode(200)
  complete(
    @CurrentUser() user: RequestUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: CompleteRightsRequestDto,
  ) {
    return this.rights.complete(user, id, dto);
  }
}

// O16 (ACTIVIDAD_6.md §6): what is objected to / blocked right now, and
// withdrawing it — the holder can always undo their own restriction.
@Controller('data-rights/controls')
@UseGuards(JwtAuthGuard)
export class ProcessingControlsController {
  constructor(private readonly rights: DataRightsService) {}

  @Get()
  mine(@CurrentUser() user: RequestUser) {
    return this.rights.controlsFor(user.id);
  }

  @Delete('objections/:purpose')
  withdrawObjection(
    @CurrentUser() user: RequestUser,
    @Param('purpose') purpose: string,
  ) {
    return this.rights.withdrawObjection(user, purpose);
  }

  @Delete('blocking')
  liftBlocking(@CurrentUser() user: RequestUser) {
    return this.rights.liftBlocking(user);
  }
}

// O16 (ACTIVIDAD_6.md §1): the channel for whoever can't (or won't) log in.
// No guard on purpose — the identity check is the emailed single-use code.
@Controller('data-rights/public-requests')
export class PublicDataRightsController {
  constructor(private readonly rights: DataRightsService) {}

  @Post()
  @HttpCode(202)
  submit(@Body() dto: PublicRightsRequestDto) {
    return this.rights.submitPublic(dto);
  }

  @Post('confirm')
  @HttpCode(200)
  confirm(@Body() dto: ConfirmPublicRequestDto) {
    return this.rights.confirmPublic(dto.code);
  }

  /** What the form offers under "oposición" (no personal data). */
  @Get('objection-purposes')
  purposes() {
    return Object.values(OBJECTION_PURPOSES);
  }
}

// Follow-up of legal deadlines by SUPPORT/ADMIN — pseudonymized subjects.
@Controller('admin/data-rights/requests')
@UseGuards(JwtAuthGuard, PermissionsGuard)
export class DataRightsAdminController {
  constructor(private readonly rights: DataRightsService) {}

  @Get()
  @RequirePermissions(Permission.DATA_REQUESTS_READ)
  list(@CurrentUser() user: RequestUser, @Query() query: ListRequestsQueryDto) {
    return this.rights.listForStaff(user, query.status);
  }
}
