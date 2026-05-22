import { Inject, Injectable } from '@nestjs/common';
import { and, eq, sql } from 'drizzle-orm';
import { NodePgDatabase } from 'drizzle-orm/node-postgres';
import type { TtsProvider } from '@bookorbit/types';

import { DB } from '../../db';
import * as schema from '../../db/schema';

type Db = NodePgDatabase<typeof schema>;

@Injectable()
export class TtsUsageRepository {
  constructor(@Inject(DB) private readonly db: Db) {}

  findForUserAndMonth(userId: number, usageMonth: string) {
    return this.db.query.ttsUsage.findMany({
      where: and(eq(schema.ttsUsage.userId, userId), eq(schema.ttsUsage.usageMonth, usageMonth)),
    });
  }

  async increment(userId: number, provider: TtsProvider, usageMonth: string, characters: number) {
    const now = new Date();
    await this.db
      .insert(schema.ttsUsage)
      .values({
        userId,
        provider,
        usageMonth,
        characterCount: characters,
        updatedAt: now,
      })
      .onConflictDoUpdate({
        target: [schema.ttsUsage.userId, schema.ttsUsage.provider, schema.ttsUsage.usageMonth],
        set: {
          characterCount: sql`${schema.ttsUsage.characterCount} + ${characters}`,
          updatedAt: now,
        },
      });
  }
}
