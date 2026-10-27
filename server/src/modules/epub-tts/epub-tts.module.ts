import { Module } from '@nestjs/common';

import { EpubTtsConfigController } from './epub-tts-config.controller';
import { EpubTtsConfigService } from './epub-tts-config.service';
import { EpubTtsController } from './epub-tts.controller';
import { EpubTtsService } from './epub-tts.service';
import { EpubTtsUsageRepository } from './epub-tts-usage.repository';
import { EpubTtsUsageService } from './epub-tts-usage.service';

@Module({
  controllers: [EpubTtsController, EpubTtsConfigController],
  providers: [EpubTtsService, EpubTtsConfigService, EpubTtsUsageRepository, EpubTtsUsageService],
  exports: [EpubTtsConfigService],
})
export class EpubTtsModule {}
