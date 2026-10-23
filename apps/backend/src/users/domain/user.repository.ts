import type { UserEntity } from './user.entity';

export interface CreateUserData {
  email: string;
  passwordHash: string;
  displayName: string;
  language: string;
  adultConfirmedAt: Date;
}

/**
 * Port the application layer codes against. The only implementation today
 * is infrastructure/prisma-user.repository.ts, but UsersService never sees
 * Prisma — inject a different class behind USER_REPOSITORY and nothing in
 * application/ or presentation/ changes.
 */
export interface TwoFactorUpdate {
  secret: string | null;
  enabled: boolean;
}

export interface UserRepository {
  findByEmail(email: string): Promise<UserEntity | null>;
  findById(id: string): Promise<UserEntity | null>;
  create(data: CreateUserData): Promise<UserEntity>;
  updateTwoFactor(userId: string, data: TwoFactorUpdate): Promise<void>;
  /** Only reachable with a current LOCATION_DISTANCE consent (UsersService.updateLocation, O15). */
  updateLocation(userId: string, lat: number, lng: number): Promise<void>;
  /** Rectification (O15). An email change also clears emailVerifiedAt. */
  updateProfile(userId: string, data: ProfileUpdate): Promise<void>;
  /**
   * Account state (O15). revokeSessions deletes every refresh token and
   * stamps sessionsRevokedAt, which JwtStrategy compares with each access
   * token's `iat` — so already-issued access tokens die too.
   */
  revokeSessions(userId: string, at: Date): Promise<void>;
  setDisabled(userId: string, disabledAt: Date | null): Promise<void>;
  setLockedUntil(userId: string, until: Date | null): Promise<void>;
}

export interface ProfileUpdate {
  displayName?: string;
  email?: string;
  language?: string;
}

export const USER_REPOSITORY = Symbol('USER_REPOSITORY');
