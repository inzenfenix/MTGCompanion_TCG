import { Module } from '@nestjs/common';
import { ScriptsModule } from './scripts/scripts.module';

@Module({
  imports: [ScriptsModule],
})
export class AppModule {}
