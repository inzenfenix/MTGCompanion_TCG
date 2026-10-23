import {
  Body,
  Controller,
  Get,
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
import {
  CreateRightsRequestDto,
  ListRequestsQueryDto,
} from './dto/create-rights-request.dto';

// ROADMAP.md O15 (ACTIVIDAD_5.md §2). Self-service: the subject is always
// the authenticated account — no route takes a user id.
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
