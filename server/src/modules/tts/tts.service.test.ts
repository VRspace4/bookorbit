import { BadGatewayException, BadRequestException } from '@nestjs/common';

import { TtsService } from './tts.service';
import { TtsConfigService } from './tts-config.service';

describe('TtsService', () => {
  let service: TtsService;
  let ttsConfig: Pick<TtsConfigService, 'getApiKey'>;
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    ttsConfig = {
      getApiKey: vi.fn((provider: string) => {
        if (provider === 'xai') return Promise.resolve('xai-key');
        if (provider === 'gcpChirp3') return Promise.resolve('gcp-key');
        if (provider === 'kokoro') return Promise.resolve('or-key');
        return Promise.resolve(null);
      }),
    };
    service = new TtsService(ttsConfig as TtsConfigService);
    fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('forwards xAI requests through OpenRouter audio speech', async () => {
    fetchMock.mockResolvedValueOnce(
      new Response(new Uint8Array([1, 2, 3]), {
        status: 200,
        headers: { 'content-type': 'audio/mpeg' },
      }),
    );

    const result = await service.synthesizeXai({ voice: 'Ara', text: 'Hello.', language: 'en' });

    expect(fetchMock).toHaveBeenCalledWith(
      'https://openrouter.ai/api/v1/audio/speech',
      expect.objectContaining({
        method: 'POST',
        headers: expect.objectContaining({
          Authorization: 'Bearer or-key',
          'Content-Type': 'application/json',
          'X-Title': 'BookOrbit',
        }),
      }),
    );
    expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toMatchObject({
      model: 'x-ai/grok-voice-tts-1.0',
      input: 'Hello.',
      voice: 'Ara',
      response_format: 'mp3',
      speed: 1,
    });
    expect(result.buffer).toEqual(Buffer.from([1, 2, 3]));
    expect(result.contentType).toBe('audio/mpeg');
  });

  it('forwards xAI speed through OpenRouter audio speech', async () => {
    fetchMock.mockResolvedValueOnce(
      new Response(new Uint8Array([1, 2, 3]), {
        status: 200,
        headers: { 'content-type': 'audio/mpeg' },
      }),
    );

    await service.synthesizeXai({ voice: 'Eve', text: 'Hello.', speed: 1.6 });

    expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toMatchObject({
      model: 'x-ai/grok-voice-tts-1.0',
      input: 'Hello.',
      voice: 'Eve',
      response_format: 'mp3',
      speed: 1.6,
    });
  });

  it('converts Google Chirp 3 audioContent to an MP3 buffer', async () => {
    fetchMock.mockResolvedValueOnce(
      new Response(JSON.stringify({ audioContent: Buffer.from([4, 5]).toString('base64') }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      }),
    );

    const result = await service.synthesizeGcpChirp3({ voice: 'en-US-Chirp3-HD-Kore', text: 'Hello.' });

    expect(fetchMock.mock.calls[0][0]).toBe('https://texttospeech.googleapis.com/v1/text:synthesize?key=gcp-key');
    expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toMatchObject({
      input: { text: 'Hello.' },
      voice: { languageCode: 'en-US', name: 'en-US-Chirp3-HD-Kore' },
      audioConfig: { audioEncoding: 'MP3', speakingRate: 1 },
    });
    expect(result).toEqual({ buffer: Buffer.from([4, 5]), contentType: 'audio/mpeg' });
  });

  it('forwards Kokoro requests through OpenRouter audio speech', async () => {
    fetchMock.mockResolvedValueOnce(
      new Response(new Uint8Array([7, 8]), {
        status: 200,
        headers: { 'content-type': 'audio/mpeg' },
      }),
    );

    const result = await service.synthesizeKokoro({ voice: 'af_bella', text: 'Hello.', speed: 1.4 });

    expect(fetchMock).toHaveBeenCalledWith(
      'https://openrouter.ai/api/v1/audio/speech',
      expect.objectContaining({
        method: 'POST',
        headers: expect.objectContaining({
          Authorization: 'Bearer or-key',
          'Content-Type': 'application/json',
          'X-Title': 'BookOrbit',
        }),
      }),
    );
    expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toMatchObject({
      model: 'hexgrad/kokoro-82m',
      input: 'Hello.',
      voice: 'af_bella',
      response_format: 'mp3',
      speed: 1.4,
    });
    expect(result).toEqual({ buffer: Buffer.from([7, 8]), contentType: 'audio/mpeg' });
  });

  it('forwards GPT-4o mini TTS requests through OpenRouter audio speech', async () => {
    fetchMock.mockResolvedValueOnce(
      new Response(new Uint8Array([9, 10]), {
        status: 200,
        headers: { 'content-type': 'audio/mpeg' },
      }),
    );

    const result = await service.synthesizeGpt4oMiniTts({ voice: 'coral', text: 'Hello.', speed: 1.2 });

    expect(fetchMock).toHaveBeenCalledWith(
      'https://openrouter.ai/api/v1/audio/speech',
      expect.objectContaining({
        method: 'POST',
        headers: expect.objectContaining({
          Authorization: 'Bearer or-key',
          'Content-Type': 'application/json',
          'X-Title': 'BookOrbit',
        }),
      }),
    );
    expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toMatchObject({
      model: 'openai/gpt-4o-mini-tts-2025-12-15',
      input: 'Hello.',
      voice: 'coral',
      response_format: 'mp3',
      speed: 1.2,
    });
    expect(result).toEqual({ buffer: Buffer.from([9, 10]), contentType: 'audio/mpeg' });
  });

  it('rejects synthesis when provider keys are not configured', async () => {
    ttsConfig.getApiKey = vi.fn(() => Promise.resolve(null));

    await expect(service.synthesizeXai({ text: 'Hello.' })).rejects.toThrow(BadRequestException);
  });

  it('surfaces upstream failures without leaking full response bodies', async () => {
    fetchMock.mockResolvedValueOnce(new Response('bad '.repeat(400), { status: 401, statusText: 'Unauthorized' }));

    await expect(service.synthesizeXai({ text: 'Hello.' })).rejects.toThrow(BadGatewayException);
  });
});
