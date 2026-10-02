import { Injectable } from '@nestjs/common';
import { FieldEncryptionService } from '../../common/crypto/field-encryption.service';
import type { Prisma } from '../../../generated/prisma';
import { PrismaService } from '../../prisma/prisma.service';
import type {
  CreateUserData,
  TwoFactorUpdate,
  UserRepository,
} from '../domain/user.repository';
import type { UserEntity } from '../domain/user.entity';

const INCLUDE_SETTINGS = { settings: true } as const;

type UserRow = Prisma.UserGetPayload<{ include: typeof INCLUDE_SETTINGS }>;

/**
 * twoFactorSecret and lastLat/lastLng are stored encrypted (AES-256-GCM,
 * ROADMAP.md O2/O3) — this repository is the only place that sees the
 * ciphertext. It encrypts on write and decrypts while mapping a row to the
 * domain entity, so UsersService/AuthService keep working with plaintext and
 * a database dump only contains `v1:<iv>:<tag>:<ciphertext>` values.
 */
@Injectable()
export class PrismaUserRepository implements UserRepository {
  constructor(
    private readonly prisma: PrismaService,
    private readonly fieldEncryption: FieldEncryptionService,
  ) {}

  private toEntity(row: UserRow): UserEntity;
  private toEntity(row: UserRow | null): UserEntity | null;
  private toEntity(row: UserRow | null): UserEntity | null {
    if (!row) return null;
    const { settings, ...user } = row;
    return {
      ...user,
      settings: settings && {
        ...settings,
        twoFactorSecret: this.fieldEncryption.decryptNullable(settings.twoFactorSecret),
        lastLat: this.fieldEncryption.decryptNumber(settings.lastLat),
        lastLng: this.fieldEncryption.decryptNumber(settings.lastLng),
      },
    };
  }

  async findByEmail(email: string): Promise<UserEntity | null> {
    const row = await this.prisma.user.findUnique({
      where: { email },
      include: INCLUDE_SETTINGS,
    });
    return this.toEntity(row);
  }

  async findById(id: string): Promise<UserEntity | null> {
    const row = await this.prisma.user.findUnique({
      where: { id },
      include: INCLUDE_SETTINGS,
    });
    return this.toEntity(row);
  }

  async create(data: CreateUserData): Promise<UserEntity> {
    const row = await this.prisma.user.create({
      data: {
        email: data.email,
        passwordHash: data.passwordHash,
        displayName: data.displayName,
        settings: { create: { language: data.language } },
      },
      include: INCLUDE_SETTINGS,
    });
    return this.toEntity(row);
  }

  async updateTwoFactor(userId: string, data: TwoFactorUpdate): Promise<void> {
    await this.prisma.userSettings.update({
      where: { userId },
      data: {
        twoFactorSecret: this.fieldEncryption.encryptNullable(data.secret),
        twoFactorEnabled: data.enabled,
      },
    });
  }

  async updateLocation(
    userId: string,
    lat: number,
    lng: number,
  ): Promise<void> {
    await this.prisma.userSettings.update({
      where: { userId },
      data: {
        shareLocation: true,
        lastLat: this.fieldEncryption.encryptNumber(lat),
        lastLng: this.fieldEncryption.encryptNumber(lng),
        locationUpdatedAt: new Date(),
      },
    });
  }
}
