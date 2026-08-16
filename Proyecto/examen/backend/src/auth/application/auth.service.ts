import { createHash, randomBytes } from 'node:crypto';
import { Inject, Injectable, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import ms from 'ms';
import type { AppConfig } from '../../config/configuration';
import { UsersService } from '../../users/application/users.service';
import type { UserResponseDto } from '../../users/presentation/dto/user-response.dto';
import {
  REFRESH_TOKEN_REPOSITORY,
  type RefreshTokenRepository,
} from '../domain/refresh-token.repository';
import type { LoginDto } from '../presentation/dto/login.dto';

export interface JwtPayload {
  sub: string; // userId
  email: string;
}

export interface LoginResult {
  accessToken: string;
  refreshToken: string;
  user: UserResponseDto;
}

export interface RefreshResult {
  accessToken: string;
  refreshToken: string;
}

@Injectable()
export class AuthService {
  constructor(
    private readonly users: UsersService,
    private readonly jwt: JwtService,
    private readonly config: ConfigService<AppConfig, true>,
    @Inject(REFRESH_TOKEN_REPOSITORY)
    private readonly refreshTokens: RefreshTokenRepository,
  ) {}

  async login(dto: LoginDto): Promise<LoginResult> {
    const user = await this.users.validateCredentials(dto.email, dto.password);
    if (!user) {
      // Same message for "no such email" and "wrong password" — see the
      // comment on UsersService.validateCredentials for why.
      throw new UnauthorizedException('Invalid email or password');
    }

    const accessToken = this.signAccessToken(user.id, user.email);
    const refreshToken = await this.issueRefreshToken(user.id);
    return { accessToken, refreshToken, user };
  }

  // Rotates on every use: the presented token is deleted and a fresh one
  // issued in its place, so replaying an already-used refresh token fails
  // outright instead of silently working — see the RefreshToken model
  // comment in schema.prisma for the full rationale.
  async refresh(rawToken: string): Promise<RefreshResult> {
    const stored = await this.refreshTokens.findByHash(
      this.hashToken(rawToken),
    );
    if (!stored) {
      throw new UnauthorizedException('Invalid or expired refresh token');
    }
    await this.refreshTokens.deleteById(stored.id); // consume it either way — expired or not, it's single-use

    if (stored.expiresAt < new Date()) {
      throw new UnauthorizedException('Invalid or expired refresh token');
    }

    const user = await this.users.findById(stored.userId);
    // Shouldn't normally happen — onDelete: Cascade removes a user's
    // refresh tokens when the user itself is deleted — but don't sign a
    // fresh access token for a user that turned out not to exist.
    if (!user) {
      throw new UnauthorizedException('Invalid or expired refresh token');
    }

    const accessToken = this.signAccessToken(user.id, user.email);
    const refreshToken = await this.issueRefreshToken(user.id);
    return { accessToken, refreshToken };
  }

  private signAccessToken(userId: string, email: string): string {
    const payload: JwtPayload = { sub: userId, email };
    return this.jwt.sign(payload);
  }

  private async issueRefreshToken(userId: string): Promise<string> {
    const raw = randomBytes(64).toString('hex');
    const refreshTtl = this.config.get('auth', { infer: true }).refreshTtl;
    const expiresAt = new Date(Date.now() + ms(refreshTtl as ms.StringValue));
    await this.refreshTokens.create({
      tokenHash: this.hashToken(raw),
      userId,
      expiresAt,
    });
    return raw;
  }

  // sha256, not bcrypt: this hashes a 512-bit random token (all entropy,
  // nothing to brute-force offline the way a human password would need
  // slowing down for), not a low-entropy user secret.
  private hashToken(raw: string): string {
    return createHash('sha256').update(raw).digest('hex');
  }
}
