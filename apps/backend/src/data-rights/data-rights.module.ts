import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { ProcessingControlModule } from '../processing-control/processing-control.module';
import { StorageModule } from '../storage/storage.module';
import { UsersModule } from '../users/users.module';
import { DATA_RIGHTS_REPOSITORY } from './domain/data-rights.repository';
import { PrismaDataRightsRepository } from './infrastructure/prisma-data-rights.repository';
import { DataRightsService } from './application/data-rights.service';
import {
  DataRightsAdminController,
  DataRightsController,
  ProcessingControlsController,
  PublicDataRightsController,
} from './presentation/data-rights.controller';

// ROADMAP.md O15 — access/portability, rectification, erasure;
// O16 — public channel, objection, blocking.
@Module({
  imports: [AuthModule, UsersModule, StorageModule, ProcessingControlModule],
  controllers: [
    DataRightsController,
    ProcessingControlsController,
    PublicDataRightsController,
    DataRightsAdminController,
  ],
  providers: [
    { provide: DATA_RIGHTS_REPOSITORY, useClass: PrismaDataRightsRepository },
    DataRightsService,
  ],
})
export class DataRightsModule {}
