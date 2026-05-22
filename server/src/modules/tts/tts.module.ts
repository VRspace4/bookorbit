import { Module } from '@nestjs/common';

import { TtsConfigController } from './tts-config.controller';
import { TtsConfigService } from './tts-config.service';
import { TtsController } from './tts.controller';
import { TtsService } from './tts.service';
import { TtsUsageRepository } from './tts-usage.repository';
import { TtsUsageService } from './tts-usage.service';

@Module({
  controllers: [TtsController, TtsConfigController],
  providers: [TtsService, TtsConfigService, TtsUsageRepository, TtsUsageService],
  exports: [TtsConfigService],
})
export class TtsModule {}
