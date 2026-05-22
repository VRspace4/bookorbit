import { BadRequestException } from '@nestjs/common';

import { TtsConfigService } from './tts-config.service';

function createInsertChain() {
  return {
    values: vi.fn().mockReturnThis(),
    onConflictDoUpdate: vi.fn().mockResolvedValue(undefined),
  };
}

function createDb() {
  const insertChain = createInsertChain();
  const txInsertChain = createInsertChain();

  const tx = {
    execute: vi.fn().mockResolvedValue(undefined),
    query: {
      appSettings: {
        findFirst: vi.fn(),
      },
    },
    insert: vi.fn().mockReturnValue(txInsertChain),
  };

  return {
    query: {
      appSettings: {
        findFirst: vi.fn(),
      },
    },
    insert: vi.fn().mockReturnValue(insertChain),
    transaction: vi.fn((cb) => Promise.resolve(cb(tx))),
    __tx: tx,
  };
}

describe('TtsConfigService', () => {
  let db: ReturnType<typeof createDb>;
  let service: TtsConfigService;

  beforeEach(() => {
    db = createDb();
    service = new TtsConfigService(db as never);
  });

  it('returns defaults when no stored config exists', async () => {
    db.query.appSettings.findFirst.mockResolvedValue(undefined);

    await expect(service.getConfig()).resolves.toEqual({
      azure: { enabled: false, apiKey: '', region: 'westus2' },
      gcpChirp3: { enabled: false, apiKey: '' },
      xai: { enabled: false, apiKey: '' },
      kokoro: { enabled: false, apiKey: '' },
    });
  });

  it('rejects enabling xAI without a Kokoro OpenRouter API key', async () => {
    db.__tx.query.appSettings.findFirst.mockResolvedValue(undefined);

    await expect(service.updateConfig({ xai: { enabled: true, apiKey: '' } })).rejects.toThrow(BadRequestException);
  });

  it('returns runtime config with azure key only when enabled', async () => {
    db.query.appSettings.findFirst.mockResolvedValue({
      key: 'tts_provider_config',
      value: JSON.stringify({
        azure: { enabled: true, apiKey: 'azure-key', region: 'eastus' },
        gcpChirp3: { enabled: false, apiKey: '' },
        xai: { enabled: true, apiKey: '' },
        kokoro: { enabled: true, apiKey: 'or-key' },
      }),
    });

    await expect(service.getRuntimeConfig()).resolves.toEqual({
      azure: { configured: true, apiKey: 'azure-key', region: 'eastus' },
      gcpChirp3: { configured: false },
      xai: { configured: true },
      kokoro: { configured: true },
    });
  });
});
