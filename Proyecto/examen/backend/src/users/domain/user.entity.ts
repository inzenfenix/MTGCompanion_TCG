/**
 * Domain shape for a user + their settings, independent of how it's
 * persisted. Application/presentation code depends on this, never on the
 * Prisma-generated types directly — that dependency is confined to
 * infrastructure/prisma-user.repository.ts, so swapping the ORM (or adding
 * a second data source) never touches UsersService or the controller.
 */
export interface UserEntity {
  id: string;
  email: string;
  passwordHash: string;
  displayName: string;
  emailVerifiedAt: Date | null;
  createdAt: Date;
  settings: {
    language: string;
    theme: string;
    twoFactorEnabled: boolean;
    // TOTP secret (base32). Internal only — never leaves this entity via
    // UserResponseDto/toResponseDto(), same boundary rule as passwordHash.
    twoFactorSecret: string | null;
    notifyByEmail: boolean;
    // Bazaar distance (E6/F6, ROADMAP.md) — see PATCH /users/me/location.
    // shareLocation false means lastLat/lastLng are stale/unused even if
    // still set from a previous opt-in; callers must check the flag, not
    // just null-check the coordinates.
    shareLocation: boolean;
    lastLat: number | null;
    lastLng: number | null;
  } | null;
}
