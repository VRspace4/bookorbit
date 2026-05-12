import { Module } from '@nestjs/common';

import { CommonModule } from '../../common/common.module';
import { UserModule } from '../user/user.module';
import { UserBookStatusModule } from '../user-book-status/user-book-status.module';
import { KoreaderAuthGuard } from './koreader-auth.guard';
import { KoreaderChapterExtractorService } from './koreader-chapter-extractor.service';
import { KoreaderChapterService } from './koreader-chapter.service';
import { KoreaderController } from './koreader.controller';
import { KoreaderRepository } from './koreader.repository';
import { KoreaderService } from './koreader.service';

@Module({
  imports: [CommonModule, UserModule, UserBookStatusModule],
  controllers: [KoreaderController],
  providers: [KoreaderService, KoreaderRepository, KoreaderAuthGuard, KoreaderChapterService, KoreaderChapterExtractorService],
  exports: [KoreaderService, KoreaderRepository],
})
export class KoreaderModule {}
