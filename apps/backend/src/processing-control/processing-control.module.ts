import { Module } from '@nestjs/common';
import { ProcessingControlService } from './application/processing-control.service';
import { PROCESSING_CONTROL_REPOSITORY } from './domain/processing-control.repository';
import { PrismaProcessingControlRepository } from './infrastructure/prisma-processing-control.repository';

// ROADMAP.md O16 — objection / blocking state, read by every process they can stop.
@Module({
  providers: [
    {
      provide: PROCESSING_CONTROL_REPOSITORY,
      useClass: PrismaProcessingControlRepository,
    },
    ProcessingControlService,
  ],
  exports: [ProcessingControlService],
})
export class ProcessingControlModule {}
