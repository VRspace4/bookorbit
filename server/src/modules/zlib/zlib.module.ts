import { Module } from '@nestjs/common';

import { BookDockModule } from '../book-dock/book-dock.module';
import { AnnaArchiveApiService } from './anna-archive-api.service';
import { ZlibApiService } from './zlib-api.service';
import { ZlibController } from './zlib.controller';
import { ZlibCredentialsService } from './zlib-credentials.service';
import { ZlibQueueService } from './zlib-queue.service';

@Module({
  imports: [BookDockModule],
  controllers: [ZlibController],
  providers: [AnnaArchiveApiService, ZlibApiService, ZlibCredentialsService, ZlibQueueService],
})
export class ZlibModule {}
