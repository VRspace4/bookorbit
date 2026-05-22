import { Body, Controller, Get, Header, HttpCode, HttpStatus, Post, Res } from '@nestjs/common';
import type { FastifyReply } from 'fastify';

import { CurrentUser } from '../../common/decorators/current-user.decorator';
import type { RequestUser } from '../../common/types/request-user';
import { GcpChirp3TtsDto } from './dto/gcp-chirp3-tts.dto';
import { Gpt4oMiniTtsDto } from './dto/gpt-4o-mini-tts.dto';
import { KokoroTtsDto } from './dto/kokoro-tts.dto';
import { RecordTtsUsageDto } from './dto/record-tts-usage.dto';
import { XaiTtsDto } from './dto/xai-tts.dto';
import { TtsConfigService } from './tts-config.service';
import { TtsService } from './tts.service';
import { TtsUsageService } from './tts-usage.service';

@Controller('tts')
export class TtsController {
  constructor(
    private readonly ttsService: TtsService,
    private readonly ttsConfig: TtsConfigService,
    private readonly ttsUsage: TtsUsageService,
  ) {}

  @Get('runtime')
  getRuntimeConfig() {
    return this.ttsConfig.getRuntimeConfig();
  }

  @Get('usage')
  getUsage(@CurrentUser() user: RequestUser) {
    return this.ttsUsage.getMonthlyUsage(user.id);
  }

  @Post('usage')
  @HttpCode(HttpStatus.NO_CONTENT)
  async recordUsage(@Body() dto: RecordTtsUsageDto, @CurrentUser() user: RequestUser) {
    await this.ttsUsage.recordUsage(user.id, dto.provider, dto.characters);
  }

  @Post('xai')
  @HttpCode(HttpStatus.OK)
  @Header('Cache-Control', 'no-store')
  async synthesizeXai(@Body() dto: XaiTtsDto, @Res() reply: FastifyReply) {
    const audio = await this.ttsService.synthesizeXai(dto);
    return reply.type(audio.contentType).header('Cache-Control', 'no-store').send(audio.buffer);
  }

  @Post('gcp-chirp3')
  @HttpCode(HttpStatus.OK)
  @Header('Cache-Control', 'no-store')
  async synthesizeGcpChirp3(@Body() dto: GcpChirp3TtsDto, @Res() reply: FastifyReply) {
    const audio = await this.ttsService.synthesizeGcpChirp3(dto);
    return reply.type(audio.contentType).header('Cache-Control', 'no-store').send(audio.buffer);
  }

  @Post('kokoro')
  @HttpCode(HttpStatus.OK)
  @Header('Cache-Control', 'no-store')
  async synthesizeKokoro(@Body() dto: KokoroTtsDto, @Res() reply: FastifyReply) {
    const audio = await this.ttsService.synthesizeKokoro(dto);
    return reply.type(audio.contentType).header('Cache-Control', 'no-store').send(audio.buffer);
  }

  @Post('gpt-4o-mini-tts')
  @HttpCode(HttpStatus.OK)
  @Header('Cache-Control', 'no-store')
  async synthesizeGpt4oMiniTts(@Body() dto: Gpt4oMiniTtsDto, @Res() reply: FastifyReply) {
    const audio = await this.ttsService.synthesizeGpt4oMiniTts(dto);
    return reply.type(audio.contentType).header('Cache-Control', 'no-store').send(audio.buffer);
  }
}
