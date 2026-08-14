import { Injectable, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { UsersService } from '../../users/application/users.service';
import type { UserResponseDto } from '../../users/presentation/dto/user-response.dto';
import type { LoginDto } from '../presentation/dto/login.dto';

export interface JwtPayload {
  sub: string; // userId
  email: string;
}

export interface LoginResult {
  accessToken: string;
  user: UserResponseDto;
}

@Injectable()
export class AuthService {
  constructor(
    private readonly users: UsersService,
    private readonly jwt: JwtService,
  ) {}

  async login(dto: LoginDto): Promise<LoginResult> {
    const user = await this.users.validateCredentials(dto.email, dto.password);
    if (!user) {
      // Same message for "no such email" and "wrong password" — see the
      // comment on UsersService.validateCredentials for why.
      throw new UnauthorizedException('Invalid email or password');
    }

    const payload: JwtPayload = { sub: user.id, email: user.email };
    return { accessToken: this.jwt.sign(payload), user };
  }
}
