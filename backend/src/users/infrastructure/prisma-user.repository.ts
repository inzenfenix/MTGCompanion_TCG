import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import type { CreateUserData, UserRepository } from '../domain/user.repository';
import type { UserEntity } from '../domain/user.entity';

const INCLUDE_SETTINGS = { settings: true } as const;

@Injectable()
export class PrismaUserRepository implements UserRepository {
  constructor(private readonly prisma: PrismaService) {}

  async findByEmail(email: string): Promise<UserEntity | null> {
    return this.prisma.user.findUnique({
      where: { email },
      include: INCLUDE_SETTINGS,
    });
  }

  async findById(id: string): Promise<UserEntity | null> {
    return this.prisma.user.findUnique({
      where: { id },
      include: INCLUDE_SETTINGS,
    });
  }

  async create(data: CreateUserData): Promise<UserEntity> {
    return this.prisma.user.create({
      data: {
        email: data.email,
        passwordHash: data.passwordHash,
        displayName: data.displayName,
        settings: { create: { language: data.language } },
      },
      include: INCLUDE_SETTINGS,
    });
  }
}
