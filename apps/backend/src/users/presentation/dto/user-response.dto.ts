import type { Role } from '../../../common/auth/permissions';

/** What the API returns for a user — never passwordHash or twoFactorSecret. */
export interface UserResponseDto {
  id: string;
  email: string;
  displayName: string;
  emailVerifiedAt: Date | null;
  // Own role only (this DTO is only ever returned to the account itself) —
  // lets the client hide admin screens; the server still enforces it.
  role: Role;
  createdAt: Date;
  settings: {
    language: string;
    theme: string;
    twoFactorEnabled: boolean;
    notifyByEmail: boolean;
    shareLocation: boolean;
  };
}

/**
 * What GET /users/:id returns about *another* user (seller on the Buy page,
 * counterparty on a transaction). Only what the app shows — never the email
 * or settings, which used to leak here without authentication (issue #146).
 */
export interface PublicUserDto {
  id: string;
  displayName: string;
}
