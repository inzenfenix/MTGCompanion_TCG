import {
  Body,
  Controller,
  Delete,
  Get,
  NotFoundException,
  Param,
  Patch,
  Post,
  UseGuards,
} from '@nestjs/common';
import { UsersService } from '../application/users.service';
import { RegisterUserDto } from './dto/register-user.dto';
import { UpdateLocationDto } from './dto/update-location.dto';
import { JwtAuthGuard } from '../../auth/presentation/jwt-auth.guard';
import { CurrentUser } from '../../auth/presentation/current-user.decorator';
import type { RequestUser } from '../../auth/presentation/jwt.strategy';

@Controller('users')
export class UsersController {
  constructor(private readonly users: UsersService) {}

  // No /login yet on purpose — this phase covers registration + the welcome
  // email only, see backend/README.md "What's next" for the auth/JWT/2FA pass.
  @Post('register')
  register(@Body() dto: RegisterUserDto) {
    return this.users.register(dto);
  }

  // Bazaar distance (E6/F6, ROADMAP.md) — 403 unless the caller holds a
  // current LOCATION_DISTANCE consent (O15, POST /consents/me/:purpose).
  @UseGuards(JwtAuthGuard)
  @Patch('me/location')
  updateLocation(
    @CurrentUser() user: RequestUser,
    @Body() dto: UpdateLocationDto,
  ) {
    return this.users.updateLocation(user.id, dto.lat, dto.lng);
  }

  // Revocation (ROADMAP.md O14/O15): same as DELETE
  // /consents/me/LOCATION_DISTANCE — the coordinates are erased, not hidden.
  @UseGuards(JwtAuthGuard)
  @Delete('me/location')
  revokeLocation(@CurrentUser() user: RequestUser) {
    return this.users.revokeLocation(user);
  }

  // Another user's public profile (seller name on the Buy page, counterparty
  // on a transaction). Logged-in only and id + displayName only: it used to
  // return email + settings to anyone holding an ownerId, and every Bazaar
  // listing exposes ownerIds (issue #146).
  @UseGuards(JwtAuthGuard)
  @Get(':id')
  async findOne(@Param('id') id: string) {
    const profile = await this.users.findPublicProfile(id);
    if (!profile) throw new NotFoundException('User not found');
    return profile;
  }
}
