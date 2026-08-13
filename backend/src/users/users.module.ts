import { Module } from '@nestjs/common';
import { USER_REPOSITORY } from './domain/user.repository';
import { PrismaUserRepository } from './infrastructure/prisma-user.repository';
import { UsersService } from './application/users.service';
import { UsersController } from './presentation/users.controller';

// Wiring lives here and only here: swap USER_REPOSITORY's useClass to point
// at a different UserRepository implementation and nothing else in this
// module (or any module that imports UsersModule) needs to change.
@Module({
  controllers: [UsersController],
  providers: [
    { provide: USER_REPOSITORY, useClass: PrismaUserRepository },
    UsersService,
  ],
  exports: [UsersService],
})
export class UsersModule {}
