import { Body, Controller, Post, UseGuards } from '@nestjs/common';
import { UsersService } from '../../users/application/users.service';
import { AuthService } from '../application/auth.service';
import { CurrentUser } from './current-user.decorator';
import { TwoFactorCodeDto } from './dto/two-factor-code.dto';
import { TwoFactorVerifyDto } from './dto/two-factor-verify.dto';
import { LoginDto } from './dto/login.dto';
import { RefreshTokenDto } from './dto/refresh-token.dto';
import { JwtAuthGuard } from './jwt-auth.guard';
import type { RequestUser } from './jwt.strategy';

@Controller('auth')
export class AuthController {
  constructor(
    private readonly auth: AuthService,
    private readonly users: UsersService,
  ) {}

  @Post('login')
  login(@Body() dto: LoginDto) {
    return this.auth.login(dto);
  }

  @Post('refresh')
  refresh(@Body() dto: RefreshTokenDto) {
    return this.auth.refresh(dto.refreshToken);
  }

  // Second step when /auth/login returned { twoFactorRequired: true } —
  // exchanges the short-lived challenge token + a current authenticator
  // code for the real access/refresh pair.
  @Post('2fa/verify')
  verifyTwoFactor(@Body() dto: TwoFactorVerifyDto) {
    return this.auth.verifyTwoFactor(dto.twoFactorToken, dto.code);
  }

  // Enrollment (all three require an existing session — you can only turn
  // 2FA on/off for the account you're logged into):
  @UseGuards(JwtAuthGuard)
  @Post('2fa/setup')
  setupTwoFactor(@CurrentUser() user: RequestUser) {
    return this.users.beginTwoFactorSetup(user.id);
  }

  @UseGuards(JwtAuthGuard)
  @Post('2fa/enable')
  enableTwoFactor(
    @CurrentUser() user: RequestUser,
    @Body() dto: TwoFactorCodeDto,
  ) {
    return this.users.confirmTwoFactorSetup(user.id, dto.code);
  }

  @UseGuards(JwtAuthGuard)
  @Post('2fa/disable')
  disableTwoFactor(
    @CurrentUser() user: RequestUser,
    @Body() dto: TwoFactorCodeDto,
  ) {
    return this.users.disableTwoFactor(user.id, dto.code);
  }
}
