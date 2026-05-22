import { Injectable, Logger } from '@nestjs/common';
import { emptyTtsMonthlyUsage, type TtsMonthlyUsage, type TtsProvider } from '@bookorbit/types';

import { sanitizeLogValue } from '../../common/utils/log-sanitize.utils';
import { TtsUsageRepository } from './tts-usage.repository';

@Injectable()
export class TtsUsageService {
  private readonly logger = new Logger(TtsUsageService.name);

  constructor(private readonly repo: TtsUsageRepository) {}

  currentUsageMonth(): string {
    const now = new Date();
    return `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, '0')}-01`;
  }

  async getMonthlyUsage(userId: number): Promise<TtsMonthlyUsage> {
    try {
      const rows = await this.repo.findForUserAndMonth(userId, this.currentUsageMonth());
      const usage = emptyTtsMonthlyUsage();
      for (const row of rows) {
        if (row.provider in usage) {
          usage[row.provider as TtsProvider] = row.characterCount;
        }
      }
      return usage;
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      this.logger.warn(`Failed to load TTS usage: ${sanitizeLogValue(message)}`);
      return emptyTtsMonthlyUsage();
    }
  }

  async recordUsage(userId: number, provider: TtsProvider, characters: number): Promise<void> {
    if (characters <= 0) return;
    try {
      await this.repo.increment(userId, provider, this.currentUsageMonth(), characters);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      this.logger.warn(`Failed to record TTS usage provider=${provider} characters=${characters}: ${sanitizeLogValue(message)}`);
    }
  }
}
