import { Module } from '@nestjs/common';
import { NotificationsModule } from '../notifications/notifications.module';
import { UsersModule } from '../users/users.module';
import { SECURITY_REPOSITORY } from './domain/security.repository';
import { PrismaSecurityRepository } from './infrastructure/prisma-security.repository';
import { SecurityService } from './application/security.service';
import { SecurityController } from './presentation/security.controller';

// ROADMAP.md O15 — detection rules, security alerts, containment tools.
@Module({
  imports: [UsersModule, NotificationsModule],
  controllers: [SecurityController],
  providers: [
    { provide: SECURITY_REPOSITORY, useClass: PrismaSecurityRepository },
    SecurityService,
  ],
})
export class SecurityModule {}
