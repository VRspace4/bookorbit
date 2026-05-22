import { BadRequestException, Inject, Injectable, Logger } from '@nestjs/common';
import { eq, sql } from 'drizzle-orm';
import { NodePgDatabase } from 'drizzle-orm/node-postgres';
import { AZURE_TTS_DEFAULT_REGION, TtsProviderConfigKey, TtsProviderConfigurations, TtsProviderStatus, TtsRuntimeConfig } from '@bookorbit/types';

import { sanitizeLogValue } from '../../common/utils/log-sanitize.utils';
import { DB } from '../../db';
import * as schema from '../../db/schema';

type Db = NodePgDatabase<typeof schema>;
type TtsConfigPatch = {
  [K in keyof TtsProviderConfigurations]?: Partial<TtsProviderConfigurations[K]>;
};

const TTS_CONFIG_KEY = 'tts_provider_config';

const DEFAULT_CONFIG: TtsProviderConfigurations = {
  azure: { enabled: false, apiKey: '', region: AZURE_TTS_DEFAULT_REGION },
  gcpChirp3: { enabled: false, apiKey: '' },
  xai: { enabled: false, apiKey: '' },
  kokoro: { enabled: false, apiKey: '' },
};

const PROVIDER_LABELS: Record<TtsProviderConfigKey, string> = {
  azure: 'Azure Speech',
  gcpChirp3: 'Google Chirp 3',
  xai: 'xAI (OpenRouter)',
  kokoro: 'Kokoro (OpenRouter)',
};

function asObject(value: unknown): Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}

function asBoolean(value: unknown, fallback: boolean): boolean {
  return typeof value === 'boolean' ? value : fallback;
}

function asString(value: unknown, fallback: string): string {
  return typeof value === 'string' ? value : fallback;
}

function mergeAzureEntry(base: TtsProviderConfigurations['azure'], value: unknown): TtsProviderConfigurations['azure'] {
  const next = asObject(value);
  const region = asString(next.region, base.region).trim();
  return {
    enabled: asBoolean(next.enabled, base.enabled),
    apiKey: asString(next.apiKey, base.apiKey),
    region: region || AZURE_TTS_DEFAULT_REGION,
  };
}

function mergeProviderEntry(base: TtsProviderConfigurations[TtsProviderConfigKey], value: unknown): TtsProviderConfigurations[TtsProviderConfigKey] {
  const next = asObject(value);
  return {
    enabled: asBoolean(next.enabled, base.enabled),
    apiKey: asString(next.apiKey, base.apiKey),
  };
}

@Injectable()
export class TtsConfigService {
  private readonly logger = new Logger(TtsConfigService.name);

  constructor(@Inject(DB) private readonly db: Db) {}

  private createDefaultConfig(): TtsProviderConfigurations {
    return {
      azure: { ...DEFAULT_CONFIG.azure },
      gcpChirp3: { ...DEFAULT_CONFIG.gcpChirp3 },
      xai: { ...DEFAULT_CONFIG.xai },
      kokoro: { ...DEFAULT_CONFIG.kokoro },
    };
  }

  private mergeConfig(base: TtsProviderConfigurations, value: unknown): TtsProviderConfigurations {
    const next = asObject(value);
    return {
      azure: mergeAzureEntry(base.azure, next.azure),
      gcpChirp3: mergeProviderEntry(base.gcpChirp3, next.gcpChirp3),
      xai: mergeProviderEntry(base.xai, next.xai),
      kokoro: mergeProviderEntry(base.kokoro, next.kokoro),
    };
  }

  private validateConfig(config: TtsProviderConfigurations): void {
    for (const key of Object.keys(PROVIDER_LABELS) as TtsProviderConfigKey[]) {
      const entry = config[key];
      if (key === 'xai') {
        if (entry.enabled && !config.kokoro.apiKey.trim()) {
          throw new BadRequestException(`${PROVIDER_LABELS.xai} requires the Kokoro OpenRouter API key before it can be enabled`);
        }
        continue;
      }
      if (entry.enabled && !entry.apiKey.trim()) {
        throw new BadRequestException(`${PROVIDER_LABELS[key]} requires an API key before it can be enabled`);
      }
      if (key === 'azure' && entry.enabled && !config.azure.region.trim()) {
        throw new BadRequestException(`${PROVIDER_LABELS.azure} requires a region before it can be enabled`);
      }
    }
  }

  private normalizeConfig(config: TtsProviderConfigurations): TtsProviderConfigurations {
    return {
      azure: config.azure.enabled && !config.azure.apiKey.trim() ? { ...config.azure, enabled: false } : config.azure,
      gcpChirp3: config.gcpChirp3.enabled && !config.gcpChirp3.apiKey.trim() ? { ...config.gcpChirp3, enabled: false } : config.gcpChirp3,
      xai: config.xai.enabled && !config.kokoro.apiKey.trim() ? { ...config.xai, enabled: false } : config.xai,
      kokoro: config.kokoro.enabled && !config.kokoro.apiKey.trim() ? { ...config.kokoro, enabled: false } : config.kokoro,
    };
  }

  private parsePersistedConfig(
    rawValue: string,
    fallback: TtsProviderConfigurations,
    source: 'get' | 'update',
    startedAt: number,
  ): TtsProviderConfigurations {
    try {
      return this.mergeConfig(fallback, JSON.parse(rawValue));
    } catch (error) {
      const durationMs = Date.now() - startedAt;
      const errorClass = error instanceof Error ? error.name : 'UnknownError';
      const rawMessage = error instanceof Error ? error.message : 'unknown error';
      const errorMessage = sanitizeLogValue(rawMessage);
      this.logger.warn(
        `[tts_provider_config.parse] [fail] key=${TTS_CONFIG_KEY} source=${source} durationMs=${durationMs} errorClass=${errorClass} error="${errorMessage}" - failed to parse persisted TTS config`,
      );
      return fallback;
    }
  }

  async getConfig(): Promise<TtsProviderConfigurations> {
    const startedAt = Date.now();
    const defaults = this.createDefaultConfig();
    const row = await this.db.query.appSettings.findFirst({
      where: eq(schema.appSettings.key, TTS_CONFIG_KEY),
    });
    if (!row) return defaults;
    return this.normalizeConfig(this.parsePersistedConfig(row.value, defaults, 'get', startedAt));
  }

  async updateConfig(patch: TtsConfigPatch): Promise<TtsProviderConfigurations> {
    const startedAt = Date.now();
    return this.db.transaction(async (tx) => {
      await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${TTS_CONFIG_KEY})::bigint)`);

      const defaults = this.createDefaultConfig();
      const row = await tx.query.appSettings.findFirst({
        where: eq(schema.appSettings.key, TTS_CONFIG_KEY),
      });
      const current = row ? this.normalizeConfig(this.parsePersistedConfig(row.value, defaults, 'update', startedAt)) : defaults;
      const next = this.mergeConfig(current, patch);
      this.validateConfig(next);
      const value = JSON.stringify(next);
      await tx
        .insert(schema.appSettings)
        .values({ key: TTS_CONFIG_KEY, value })
        .onConflictDoUpdate({ target: schema.appSettings.key, set: { value } });
      return next;
    });
  }

  async getProviderStatuses(config?: TtsProviderConfigurations): Promise<TtsProviderStatus[]> {
    const cfg = config ?? (await this.getConfig());
    return (Object.keys(PROVIDER_LABELS) as TtsProviderConfigKey[]).map((key) => {
      const entry = cfg[key];
      const configured = key === 'xai' ? !!cfg.kokoro.apiKey.trim() : !!entry.apiKey.trim();
      const hint = key === 'xai' && !configured ? 'Kokoro OpenRouter API key required' : !configured ? 'API key required' : undefined;
      return {
        key,
        label: PROVIDER_LABELS[key],
        enabled: entry.enabled,
        configured,
        hint,
      };
    });
  }

  async getRuntimeConfig(): Promise<TtsRuntimeConfig> {
    const config = await this.getConfig();
    return {
      azure: {
        configured: config.azure.enabled && !!config.azure.apiKey.trim(),
        apiKey: config.azure.enabled && config.azure.apiKey.trim() ? config.azure.apiKey : undefined,
        region: config.azure.region.trim() || AZURE_TTS_DEFAULT_REGION,
      },
      gcpChirp3: {
        configured: config.gcpChirp3.enabled && !!config.gcpChirp3.apiKey.trim(),
      },
      xai: {
        configured: config.xai.enabled && config.kokoro.enabled && !!config.kokoro.apiKey.trim(),
      },
      kokoro: {
        configured: config.kokoro.enabled && !!config.kokoro.apiKey.trim(),
      },
    };
  }

  async getApiKey(provider: TtsProviderConfigKey): Promise<string | null> {
    const config = await this.getConfig();
    const entry = config[provider];
    if (!entry.enabled || !entry.apiKey.trim()) return null;
    return entry.apiKey;
  }
}
