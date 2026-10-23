import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
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
  EMAIL_CHANGED_EVENT,
  EmailChangedEvent,
} from '../../common/events/email-changed.event';
import { ConsentService } from '../../consent/application/consent.service';
import {
  USER_REPOSITORY,
  type ProfileUpdate,
  type UserRepository,
} from '../domain/user.repository';
import type { UserEntity } from '../domain/user.entity';
import { coarsenCoordinate } from '../domain/location-precision';
import type { Role } from '../../common/auth/permissions';
import type { RegisterUserDto } from '../presentation/dto/register-user.dto';
import type {
  UserResponseDto,
  PublicUserDto,
} from '../presentation/dto/user-response.dto';

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

/** What JwtStrategy attaches to every authenticated request (role re-read from the DB each time). */
export interface AuthContext {
  id: string;
  email: string;
  role: Role;
  /** Access tokens issued before this are rejected (O15 containment). */
  sessionsRevokedAt: Date | null;
}

/**
 * Outcome of a login attempt (O15). Callers turn every failure into the
 * same generic 401 — the reason only feeds the audit log and detection.
 */
export type CredentialCheck =
  | { ok: true; user: UserResponseDto }
  | {
      ok: false;
      reason: 'unknown-email' | 'bad-password' | 'locked' | 'disabled';
      userId: string | null;
      role: Role | null;
    };

// Compared against when the email doesn't exist, so a login for an unknown
// email costs the same bcrypt time as a wrong password — response timing
// doesn't reveal which emails have accounts.
const DUMMY_HASH = bcrypt.hashSync('timing-equalizer-not-a-password', 12);

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
    private readonly consent: ConsentService,
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
      // RegisterUserDto only lets this through as `true` (@Equals) — what's
      // stored is when the declaration was made, never a birth date.
      adultConfirmedAt: new Date(),
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

  /**
   * Called by JwtStrategy on every authenticated request — the role comes
   * from here, not from the token, so a demotion (PATCH /admin/users/:id/role)
   * applies on the very next request instead of when the access token expires.
   */
  async findAuthContext(id: string): Promise<AuthContext | null> {
    const user = await this.users.findById(id);
    // Erased or disabled (O15) = no session works, from the next request on.
    if (!user || user.deletedAt || user.disabledAt) return null;
    return {
      id: user.id,
      email: user.email,
      role: user.role,
      sessionsRevokedAt: user.sessionsRevokedAt,
    };
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
  async checkCredentials(
    email: string,
    password: string,
  ): Promise<CredentialCheck> {
    const user = await this.users.findByEmail(email);
    if (!user || user.deletedAt) {
      await bcrypt.compare(password, DUMMY_HASH);
      return { ok: false, reason: 'unknown-email', userId: null, role: null };
    }
    const fail = (reason: 'bad-password' | 'locked' | 'disabled') =>
      ({ ok: false, reason, userId: user.id, role: user.role }) as const;
    if (user.disabledAt) return fail('disabled');
    // While locked the password isn't even evaluated, so guessing during
    // the lock teaches the attacker nothing.
    if (user.lockedUntil && user.lockedUntil > new Date()) {
      return fail('locked');
    }
    const matches = await bcrypt.compare(password, user.passwordHash);
    return matches
      ? { ok: true, user: this.toResponseDto(user) }
      : fail('bad-password');
  }

  /** Step-up re-authentication (O15): the password of an already-logged-in account. */
  async verifyPassword(userId: string, password: string): Promise<boolean> {
    const user = await this.users.findById(userId);
    if (!user || user.deletedAt || user.disabledAt) return false;
    return bcrypt.compare(password, user.passwordHash);
  }

  /**
   * Rectification (O15, ACTIVIDAD_5.md §2.3). Values were already validated
   * by the DTO (same rules as registration); this adds the rules that need
   * the database. An email change must be unique, drops the verification
   * mark, ends every session and tells the *old* address — if someone else
   * made the change, that's how the owner finds out.
   * Returns the names of the fields that actually changed (never values).
   */
  async rectifyProfile(
    userId: string,
    update: ProfileUpdate,
  ): Promise<string[]> {
    const user = await this.users.findById(userId);
    if (!user || user.deletedAt) {
      throw new BadRequestException('User not found');
    }
    const changes: ProfileUpdate = {};
    if (
      update.displayName !== undefined &&
      update.displayName !== user.displayName
    ) {
      changes.displayName = update.displayName;
    }
    if (
      update.language !== undefined &&
      update.language !== user.settings?.language
    ) {
      changes.language = update.language;
    }
    // Compared and stored exactly like registration does (no case folding),
    // so the @unique email and findByEmail keep meaning the same thing.
    const newEmail = update.email?.trim();
    if (newEmail !== undefined && newEmail !== user.email) {
      if (await this.users.findByEmail(newEmail)) {
        throw new ConflictException(
          'An account with this email already exists',
        );
      }
      changes.email = newEmail;
    }
    const fields = Object.keys(changes);
    if (fields.length === 0) return [];

    await this.users.updateProfile(userId, changes);
    if (changes.email) {
      await this.users.revokeSessions(userId, new Date());
      this.events.emit(
        EMAIL_CHANGED_EVENT,
        new EmailChangedEvent(
          user.email,
          changes.displayName ?? user.displayName,
        ),
      );
    }
    return fields;
  }

  /** Containment (O15): refresh tokens deleted, every access token issued so far rejected. */
  revokeSessions(userId: string): Promise<void> {
    return this.users.revokeSessions(userId, new Date());
  }

  async setDisabled(userId: string, disabled: boolean): Promise<void> {
    await this.users.setDisabled(userId, disabled ? new Date() : null);
    if (disabled) await this.users.revokeSessions(userId, new Date());
  }

  lockUntil(userId: string, until: Date | null): Promise<void> {
    return this.users.setLockedUntil(userId, until);
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
    // Enabling 2FA *is* the consent to keep the secret (O15) — recorded by
    // the flow that proved a code, never by a bare toggle.
    await this.consent.change(user, 'TWO_FACTOR', 'GRANTED', 'two-factor');
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
    await this.consent.change(user, 'TWO_FACTOR', 'REVOKED', 'two-factor');
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
   * Bazaar distance (E6/F6, ROADMAP.md). Since O15 the consent is explicit
   * and separate (POST /consents/me/LOCATION_DISTANCE): without a current
   * one this refuses with 403 instead of storing anything. Raw lat/lng never leave this
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
    if (!(await this.consent.hasConsent(userId, 'LOCATION_DISTANCE'))) {
      throw new ForbiddenException(
        'Location consent required (POST /consents/me/LOCATION_DISTANCE)',
      );
    }
    // Minimization (O14): coarsened to ~1 km *before* it reaches the
    // repository (and its encryption), see domain/location-precision.ts.
    await this.users.updateLocation(
      userId,
      coarsenCoordinate(lat),
      coarsenCoordinate(lng),
    );
    const user = await this.users.findById(userId);
    if (!user) throw new BadRequestException('User not found');
    return this.toResponseDto(user);
  }

  /**
   * DELETE /users/me/location — kept for older app builds; same as DELETE
   * /consents/me/LOCATION_DISTANCE (revokes, and erases the coordinates).
   */
  async revokeLocation(actor: {
    id: string;
    role: Role;
  }): Promise<UserResponseDto> {
    await this.consent.change(actor, 'LOCATION_DISTANCE', 'REVOKED', 'app');
    const user = await this.users.findById(actor.id);
    if (!user) throw new BadRequestException('User not found');
    return this.toResponseDto(user);
  }

  private toResponseDto(user: UserEntity): UserResponseDto {
    return {
      id: user.id,
      email: user.email,
      displayName: user.displayName,
      emailVerifiedAt: user.emailVerifiedAt,
      role: user.role,
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
