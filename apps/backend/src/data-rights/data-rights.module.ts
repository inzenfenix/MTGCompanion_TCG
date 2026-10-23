import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { StorageModule } from '../storage/storage.module';
import { UsersModule } from '../users/users.module';
import { DATA_RIGHTS_REPOSITORY } from './domain/data-rights.repository';
import { PrismaDataRightsRepository } from './infrastructure/prisma-data-rights.repository';
import { DataRightsService } from './application/data-rights.service';
import {
  DataRightsAdminController,
  DataRightsController,
} from './presentation/data-rights.controller';

// ROADMAP.md O15 — access/portability, rectification, erasure.
@Module({
  imports: [AuthModule, UsersModule, StorageModule],
  controllers: [DataRightsController, DataRightsAdminController],
  providers: [
    { provide: DATA_RIGHTS_REPOSITORY, useClass: PrismaDataRightsRepository },
    DataRightsService,
  ],
})
export class DataRightsModule {}
