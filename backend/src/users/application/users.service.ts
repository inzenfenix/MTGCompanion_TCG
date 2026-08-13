import { ConflictException, Inject, Injectable } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import * as bcrypt from 'bcryptjs';
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
import type { UserResponseDto } from '../presentation/dto/user-response.dto';

const SALT_ROUNDS = 12;

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
      },
    };
  }
}
