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
    notifyByEmail: boolean;
  } | null;
}
