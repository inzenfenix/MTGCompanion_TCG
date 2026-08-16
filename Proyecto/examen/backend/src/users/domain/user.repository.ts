import type { UserEntity } from './user.entity';

export interface CreateUserData {
  email: string;
  passwordHash: string;
  displayName: string;
  language: string;
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
}

export const USER_REPOSITORY = Symbol('USER_REPOSITORY');
