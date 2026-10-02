import {
  BadRequestException,
  ConflictException,
  Inject,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import * as bcrypt from 'bcryptjs';
import { generateSecret, generateURI, verify as verifyTotp } from 'otplib';
import * as QRCode from 'qrcode';
import {
  USER_CREATED_EVENT,
  UserCreatedEvent,
} from '../../common/events/user-created.event';
import {
  USER_REPOSITORY,
  type UserRepository,
} from '../domain/user.repository';
import type { UserEntity } from '../domain/user.entity';
import type { RegisterUserDto } from '../presentation/dto/register-user.dto';
import type { UserResponseDto, PublicUserDto } from '../presentation/dto/user-response.dto';

const SALT_ROUNDS = 12;

// Shown to the user's authenticator app as the account group (e.g. "MTG
// Companion (user@example.com)"). Purely cosmetic, no config needed.
const TOTP_ISSUER = 'MTG Companion';

// Authenticator apps and the server clock drift a little — accept one 30s
// step on either side of "now" (symmetric epochTolerance) instead of an
// exact match.
const TOTP_EPOCH_TOLERANCE_SECONDS = 30;

async function checkTotpCode(secret: string, code: string): Promise<boolean> {
  const result = await verifyTotp({
    secret,
    token: code,
    epochTolerance: TOTP_EPOCH_TOLERANCE_SECONDS,
  });
  return result.valid;
}

export interface TwoFactorSetup {
  secret: string;
  otpauthUrl: string;
  qrCodeDataUrl: string;
}

// Use-case orchestrator: talks to the domain port (UserRepository) and to
// cross-cutting infra (EventEmitter2), never to Prisma directly — that's
// what makes this layer swappable/testable independent of persistence.
@Injectable()
export class UsersService {
  constructor(
    @Inject(USER_REPOSITORY) private readonly users: UserRepository,
    private readonly events: EventEmitter2,
  ) {}

  async register(dto: RegisterUserDto): Promise<UserResponseDto> {
    const existing = await this.users.findByEmail(dto.email);
    if (existing) {
      throw new ConflictException('An account with this email already exists');
    }

    const passwordHash = await bcrypt.hash(dto.password, SALT_ROUNDS);
    const user = await this.users.create({
      email: dto.email,
      passwordHash,
      displayName: dto.displayName,
      language: dto.language ?? 'en',
    });

    // Login/JWT/2FA are a later pass — this phase only registers the user
    // and fires the welcome email (see NotificationsModule).
    this.events.emit(
      USER_CREATED_EVENT,
      new UserCreatedEvent(user.id, user.email, user.displayName),
    );

    return this.toResponseDto(user);
  }

  async findById(id: string): Promise<UserResponseDto | null> {
    const user = await this.users.findById(id);
    return user ? this.toResponseDto(user) : null;
  }

  /** Another user's public profile — id + displayName only (issue #146). */
  async findPublicProfile(id: string): Promise<PublicUserDto | null> {
    const user = await this.users.findById(id);
    return user ? { id: user.id, displayName: user.displayName } : null;
  }

  /**
   * Password check lives here (not in AuthModule) so passwordHash never
   * leaves the Users boundary — AuthService gets back either a clean
   * UserResponseDto or null, never the hash itself. Same email-not-found vs.
   * wrong-password outcome (null either way) on purpose: doesn't leak which
   * emails are registered.
   */
  async validateCredentials(
    email: string,
    password: string,
  ): Promise<UserResponseDto | null> {
    const user = await this.users.findByEmail(email);
    if (!user) return null;
    const matches = await bcrypt.compare(password, user.passwordHash);
    return matches ? this.toResponseDto(user) : null;
  }

  /**
   * Step 1 of enrollment: generate a fresh TOTP secret and store it as
   * *pending* (twoFactorEnabled stays false until confirmTwoFactorSetup
   * proves the user actually scanned it into a real authenticator app —
   * otherwise a user could get locked out by a QR code they never saved).
   */
  async beginTwoFactorSetup(userId: string): Promise<TwoFactorSetup> {
    const user = await this.users.findById(userId);
    if (!user) throw new BadRequestException('User not found');
    if (user.settings?.twoFactorEnabled) {
      throw new ConflictException(
        'Two-factor authentication is already enabled',
      );
    }

    const secret = generateSecret();
    const otpauthUrl = generateURI({
      issuer: TOTP_ISSUER,
      label: user.email,
      secret,
    });
    const qrCodeDataUrl = await QRCode.toDataURL(otpauthUrl);
    await this.users.updateTwoFactor(userId, { secret, enabled: false });

    return { secret, otpauthUrl, qrCodeDataUrl };
  }

  /** Step 2 of enrollment: prove the pending secret was actually scanned. */
  async confirmTwoFactorSetup(
    userId: string,
    code: string,
  ): Promise<UserResponseDto> {
    const user = await this.users.findById(userId);
    const secret = user?.settings?.twoFactorSecret;
    if (!user || !secret) {
      throw new BadRequestException(
        'No pending two-factor setup for this account',
      );
    }
    if (!(await checkTotpCode(secret, code))) {
      throw new UnauthorizedException('Invalid two-factor code');
    }

    await this.users.updateTwoFactor(userId, { secret, enabled: true });
    return this.toResponseDto({
      ...user,
      settings: { ...user.settings!, twoFactorEnabled: true },
    });
  }

  /** Requires a current code (not just being logged in) — same bar as enrolling. */
  async disableTwoFactor(
    userId: string,
    code: string,
  ): Promise<UserResponseDto> {
    const user = await this.users.findById(userId);
    const secret = user?.settings?.twoFactorSecret;
    if (!user || !user.settings?.twoFactorEnabled || !secret) {
      throw new BadRequestException('Two-factor authentication is not enabled');
    }
    if (!(await checkTotpCode(secret, code))) {
      throw new UnauthorizedException('Invalid two-factor code');
    }

    await this.users.updateTwoFactor(userId, { secret: null, enabled: false });
    return this.toResponseDto({
      ...user,
      settings: {
        ...user.settings,
        twoFactorEnabled: false,
        twoFactorSecret: null,
      },
    });
  }

  /** Used by AuthService's login-challenge step — never exposed directly as an endpoint. */
  async verifyTwoFactorCode(userId: string, code: string): Promise<boolean> {
    const user = await this.users.findById(userId);
    const secret = user?.settings?.twoFactorSecret;
    if (!user?.settings?.twoFactorEnabled || !secret) return false;
    return checkTotpCode(secret, code);
  }

  /**
   * Bazaar distance (E6/F6, ROADMAP.md). Calling this endpoint at all is the
   * consent — there's no separate "share my location" toggle, same pattern
   * a dating-app-style location prompt uses. Raw lat/lng never leave this
   * boundary via UserResponseDto (see toResponseDto below); only
   * CardsService's searchListings() ever reads them back out, and only to
   * compute a distance, never to return the coordinates themselves.
   */
  async updateLocation(
    userId: string,
    lat: number,
    lng: number,
  ): Promise<UserResponseDto> {
    if (
      Number.isNaN(lat) ||
      Number.isNaN(lng) ||
      lat < -90 ||
      lat > 90 ||
      lng < -180 ||
      lng > 180
    ) {
      throw new BadRequestException('Invalid lat/lng');
    }
    await this.users.updateLocation(userId, lat, lng);
    const user = await this.users.findById(userId);
    if (!user) throw new BadRequestException('User not found');
    return this.toResponseDto(user);
  }

  private toResponseDto(user: UserEntity): UserResponseDto {
    return {
      id: user.id,
      email: user.email,
      displayName: user.displayName,
      emailVerifiedAt: user.emailVerifiedAt,
      createdAt: user.createdAt,
      settings: {
        language: user.settings?.language ?? 'en',
        theme: user.settings?.theme ?? 'dark',
        twoFactorEnabled: user.settings?.twoFactorEnabled ?? false,
        notifyByEmail: user.settings?.notifyByEmail ?? true,
        shareLocation: user.settings?.shareLocation ?? false,
      },
    };
  }
}
