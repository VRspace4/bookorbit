import { Inject, Injectable } from '@nestjs/common';
import { and, eq, sql } from 'drizzle-orm';
import { NodePgDatabase } from 'drizzle-orm/node-postgres';

import { DB } from '../../../db';
import * as schema from '../../../db/schema';
import { UserBookStatusService } from '../../user-book-status/user-book-status.service';
import { KoboBookAccessService } from './kobo-book-access.service';

type Db = NodePgDatabase<typeof schema>;
type JsonObj = Record<string, unknown>;

function mergeSubObject(incoming: JsonObj | null | undefined, existing: JsonObj | null | undefined): JsonObj | null {
  if (!incoming) return existing ?? null;
  if (!existing) return incoming;
  const a = incoming.LastModified as string | undefined;
  const b = existing.LastModified as string | undefined;
  if (!a || !b) return incoming;
  return a >= b ? incoming : existing;
}

@Injectable()
export class KoboReadingStateService {
  constructor(
    @Inject(DB) private readonly db: Db,
    private readonly bookAccessService: KoboBookAccessService,
    private readonly userBookStatusService: UserBookStatusService,
  ) {}

  async upsertState(userId: number, bookId: number, payload: Record<string, unknown>, readingThreshold: number, finishedThreshold: number) {
    await this.bookAccessService.assertBookAccessible(userId, bookId);

    const entitlementId = String(bookId);
    const now = new Date().toISOString();

    const book = await this.db.query.books.findFirst({
      where: eq(schema.books.id, bookId),
      columns: { id: true },
    });
    if (!book) {
      return {
        RequestResult: 'Success',
        UpdateResults: [
          {
            EntitlementId: entitlementId,
            CurrentBookmarkResult: { Result: 'Ignored' },
            StatisticsResult: { Result: 'Ignored' },
            StatusInfoResult: { Result: 'Ignored' },
          },
        ],
      };
    }

    const created = (payload.Created as string | undefined) ?? now;
    const lastModified = (payload.LastModified as string | undefined) ?? now;
    const priorityTimestamp = (payload.PriorityTimestamp as string | undefined) ?? lastModified;

    const incomingBookmark = (payload.CurrentBookmark as JsonObj | undefined) ?? null;
    const incomingStats = (payload.Statistics as JsonObj | undefined) ?? null;
    const incomingStatus = (payload.StatusInfo as JsonObj | undefined) ?? null;

    const existing = await this.db.query.koboReadingStates.findFirst({
      where: and(eq(schema.koboReadingStates.userId, userId), eq(schema.koboReadingStates.bookId, bookId)),
    });

    const mergedBookmark = mergeSubObject(incomingBookmark, existing?.currentBookmark as JsonObj | null);
    const mergedStats = mergeSubObject(incomingStats, existing?.statistics as JsonObj | null);
    const mergedStatus = mergeSubObject(incomingStatus, existing?.statusInfo as JsonObj | null);

    await this.db
      .insert(schema.koboReadingStates)
      .values({
        userId,
        bookId,
        entitlementId,
        createdAtKobo: created,
        lastModifiedKobo: lastModified,
        priorityTimestamp,
        currentBookmark: mergedBookmark,
        statistics: mergedStats,
        statusInfo: mergedStatus,
        updatedAt: new Date(),
      })
      .onConflictDoUpdate({
        target: [schema.koboReadingStates.userId, schema.koboReadingStates.bookId],
        set: {
          lastModifiedKobo: lastModified,
          priorityTimestamp,
          currentBookmark: sql`excluded.current_bookmark`,
          statistics: sql`excluded.statistics`,
          statusInfo: sql`excluded.status_info`,
          updatedAt: sql`now()`,
        },
      });

    const percent = this.extractPercent(mergedBookmark);
    if (percent !== null) {
      void this.userBookStatusService.autoUpdate(userId, bookId, percent, readingThreshold, finishedThreshold);
    }

    return this.getRawState(userId, bookId);
  }

  async getRawState(userId: number, bookId: number): Promise<unknown> {
    await this.bookAccessService.assertBookAccessible(userId, bookId);

    const row = await this.db.query.koboReadingStates.findFirst({
      where: and(eq(schema.koboReadingStates.userId, userId), eq(schema.koboReadingStates.bookId, bookId)),
    });

    if (!row) return null;

    return {
      EntitlementId: row.entitlementId,
      Created: row.createdAtKobo,
      LastModified: row.lastModifiedKobo,
      PriorityTimestamp: row.priorityTimestamp,
      CurrentBookmark: row.currentBookmark,
      Statistics: row.statistics,
      StatusInfo: row.statusInfo,
    };
  }

  private extractPercent(bookmark: JsonObj | null): number | null {
    if (!bookmark) return null;
    const pct = bookmark.ProgressPercent ?? bookmark.ContentSourceProgressPercent;
    if (typeof pct === 'number') return Math.max(0, Math.min(100, pct));
    return null;
  }
}
