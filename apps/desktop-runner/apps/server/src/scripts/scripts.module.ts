import { Module } from '@nestjs/common';
import { ScriptsController } from './scripts.controller';
import { ScriptsService } from './scripts.service';
import { LogsGateway } from './logs.gateway';

@Module({
  controllers: [ScriptsController],
  providers: [ScriptsService, LogsGateway],
})
export class ScriptsModule {}
