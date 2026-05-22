import { BadGatewayException, BadRequestException, Injectable, Logger } from '@nestjs/common';

import { sanitizeLogValue } from '../../common/utils/log-sanitize.utils';
import type { GcpChirp3TtsDto } from './dto/gcp-chirp3-tts.dto';
import type { Gpt4oMiniTtsDto } from './dto/gpt-4o-mini-tts.dto';
import type { KokoroTtsDto } from './dto/kokoro-tts.dto';
import type { XaiTtsDto } from './dto/xai-tts.dto';
import { TtsConfigService } from './tts-config.service';

const GCP_TTS_ENDPOINT = 'https://texttospeech.googleapis.com/v1/text:synthesize';
const OPENROUTER_TTS_ENDPOINT = 'https://openrouter.ai/api/v1/audio/speech';
const KOKORO_MODEL = 'hexgrad/kokoro-82m';
const XAI_TTS_MODEL = 'x-ai/grok-voice-tts-1.0';
const GPT_4O_MINI_TTS_MODEL = 'openai/gpt-4o-mini-tts-2025-12-15';
const REQUEST_TIMEOUT_MS = 120_000;

interface AudioProxyResult {
  buffer: Buffer;
  contentType: string;
}

@Injectable()
export class TtsService {
  private readonly logger = new Logger(TtsService.name);

  constructor(private readonly ttsConfig: TtsConfigService) {}

  async synthesizeXai(dto: XaiTtsDto): Promise<AudioProxyResult> {
    const apiKey = await this.ttsConfig.getApiKey('kokoro');
    if (!apiKey) throw new BadRequestException('xAI TTS is not configured');
    return this.synthesizeOpenRouter('xai', apiKey, {
      model: XAI_TTS_MODEL,
      text: dto.text,
      voice: dto.voice || 'Eve',
      speed: dto.speed,
    });
  }

  async synthesizeGcpChirp3(dto: GcpChirp3TtsDto): Promise<AudioProxyResult> {
    const apiKey = await this.ttsConfig.getApiKey('gcpChirp3');
    if (!apiKey) throw new BadRequestException('Google Chirp 3 TTS is not configured');
    const languageCode = dto.languageCode || 'en-US';
    const speakingRate = dto.speakingRate === undefined ? 1 : Math.min(2, Math.max(0.25, dto.speakingRate));
    const url = `${GCP_TTS_ENDPOINT}?key=${encodeURIComponent(apiKey)}`;
    const response = await this.fetchWithTimeout(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        input: { text: dto.text },
        voice: {
          languageCode,
          name: dto.voice,
        },
        audioConfig: {
          audioEncoding: 'MP3',
          speakingRate,
        },
      }),
    });

    if (!response.ok) {
      await this.throwProxyError('gcp-chirp3', response);
    }

    const payload = (await response.json()) as { audioContent?: string };
    if (!payload.audioContent) {
      throw new BadGatewayException('Google TTS returned no audio content');
    }

    return {
      buffer: Buffer.from(payload.audioContent, 'base64'),
      contentType: 'audio/mpeg',
    };
  }

  async synthesizeKokoro(dto: KokoroTtsDto): Promise<AudioProxyResult> {
    const apiKey = await this.ttsConfig.getApiKey('kokoro');
    if (!apiKey) throw new BadRequestException('Kokoro TTS is not configured');
    return this.synthesizeOpenRouter('kokoro', apiKey, {
      model: dto.model || KOKORO_MODEL,
      text: dto.text,
      voice: dto.voice,
      speed: dto.speed,
    });
  }

  async synthesizeGpt4oMiniTts(dto: Gpt4oMiniTtsDto): Promise<AudioProxyResult> {
    const apiKey = await this.ttsConfig.getApiKey('kokoro');
    if (!apiKey) throw new BadRequestException('GPT TTS is not configured');
    return this.synthesizeOpenRouter('gpt-4o-mini-tts', apiKey, {
      model: GPT_4O_MINI_TTS_MODEL,
      text: dto.text,
      voice: dto.voice,
      speed: dto.speed,
    });
  }

  private async synthesizeOpenRouter(
    provider: string,
    apiKey: string,
    dto: { model: string; text: string; voice: string; speed?: number },
  ): Promise<AudioProxyResult> {
    const speed = dto.speed === undefined ? 1 : Math.min(2, Math.max(0.5, dto.speed));
    const response = await this.fetchWithTimeout(OPENROUTER_TTS_ENDPOINT, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
        'HTTP-Referer': 'https://bookorbit.ridethew.com',
        'X-Title': 'BookOrbit',
      },
      body: JSON.stringify({
        model: dto.model,
        input: dto.text,
        voice: dto.voice,
        response_format: 'mp3',
        speed,
      }),
    });

    if (!response.ok) {
      await this.throwProxyError(provider, response);
    }

    return {
      buffer: Buffer.from(await response.arrayBuffer()),
      contentType: response.headers.get('content-type') || 'audio/mpeg',
    };
  }

  private async fetchWithTimeout(url: string, init: RequestInit): Promise<Response> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
    try {
      return await fetch(url, { ...init, signal: controller.signal });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      throw new BadGatewayException(`TTS upstream request failed: ${sanitizeLogValue(message)}`);
    } finally {
      clearTimeout(timeout);
    }
  }

  private async throwProxyError(provider: string, response: Response): Promise<never> {
    const body = await response.text().catch(() => '');
    const detail = sanitizeLogValue(body.slice(0, 1000) || response.statusText);
    this.logger.warn(`[tts.${provider}] upstream failed status=${response.status} detail="${detail}"`);
    throw new BadGatewayException(`${provider} TTS failed with status ${response.status}: ${detail}`);
  }
}
