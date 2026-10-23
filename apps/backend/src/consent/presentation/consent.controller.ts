import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Post,
  UseGuards,
} from '@nestjs/common';
import { JwtAuthGuard } from '../../auth/presentation/jwt-auth.guard';
import { CurrentUser } from '../../auth/presentation/current-user.decorator';
import type { RequestUser } from '../../auth/presentation/jwt.strategy';
import { ConsentService } from '../application/consent.service';
import { GrantConsentDto } from './dto/grant-consent.dto';

// ROADMAP.md O15 (ACTIVIDAD_5.md §1). Every route acts on the caller's own
// consents only: there is no :userId parameter anywhere, so there's no id
// to tamper with — the subject is always the authenticated account.
@Controller('consents')
export class ConsentController {
  constructor(private readonly consents: ConsentService) {}

  // Public: what each purpose means is information the player must be
  // able to read *before* deciding (art. 12 "informado").
  @Get('purposes')
  purposes() {
    return this.consents.purposes();
  }

  @UseGuards(JwtAuthGuard)
  @Get('me')
  mine(@CurrentUser() user: RequestUser) {
    return this.consents.listForUser(user.id);
  }

  @UseGuards(JwtAuthGuard)
  @Get('me/history')
  history(@CurrentUser() user: RequestUser) {
    return this.consents.history(user.id);
  }

  @UseGuards(JwtAuthGuard)
  @Post('me/:purpose')
  grant(
    @CurrentUser() user: RequestUser,
    @Param('purpose') purpose: string,
    @Body() dto: GrantConsentDto,
  ) {
    return this.consents.grantFromApp(user, purpose, dto.version);
  }

  @UseGuards(JwtAuthGuard)
  @Delete('me/:purpose')
  revoke(@CurrentUser() user: RequestUser, @Param('purpose') purpose: string) {
    return this.consents.revokeFromApp(user, purpose);
  }
}
