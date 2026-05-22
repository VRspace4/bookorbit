import { Inject, Injectable, Logger, NotFoundException, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createCipheriv, createDecipheriv, randomBytes } from 'crypto';
import { eq, sql } from 'drizzle-orm';
import { NodePgDatabase } from 'drizzle-orm/node-postgres';

import { DB } from '../../db/db.module';
import * as schema from '../../db/schema';
import { zlibCredentials } from '../../db/schema/zlib';

type Db = NodePgDatabase<typeof schema>;

const ALGORITHM = 'aes-256-gcm';
const IV_LENGTH = 12;
const TAG_LENGTH = 16;

@Injectable()
export class ZlibCredentialsService implements OnModuleInit {
  private readonly logger = new Logger(ZlibCredentialsService.name);
  private readonly key: Buffer | null;

  constructor(
    @Inject(DB) private readonly db: Db,
    private readonly config: ConfigService,
  ) {
    const raw = this.config.get<string>('zlib.encryptionKey') ?? '';
    if (raw.length === 64) {
      this.key = Buffer.from(raw, 'hex');
    } else {
      if (raw.length > 0) {
        this.logger.warn('ZLIB_ENCRYPTION_KEY must be a 64-char hex string. Z-Library keys will be stored unencrypted.');
      }
      this.key = null;
    }
  }

  async onModuleInit(): Promise<void> {
    try {
      await this.db.execute(sql`
        CREATE TABLE IF NOT EXISTS "zlib_credentials" (
          "id" serial PRIMARY KEY NOT NULL,
          "user_id" integer NOT NULL,
          "email" varchar(255) NOT NULL,
          "remix_user_id" varchar(100) NOT NULL,
          "remix_user_key" text NOT NULL,
          "created_at" timestamp with time zone DEFAULT now() NOT NULL,
          "updated_at" timestamp with time zone DEFAULT now() NOT NULL
        )
      `);
      await this.db.execute(sql`
        CREATE UNIQUE INDEX IF NOT EXISTS "zlib_credentials_user_id_uidx"
        ON "zlib_credentials" ("user_id")
      `);
      await this.db.execute(sql`
        ALTER TABLE "zlib_credentials" ADD COLUMN IF NOT EXISTS "session_cookies" text NOT NULL DEFAULT ''
      `);
      await this.db.execute(sql`
        ALTER TABLE "zlib_credentials" ADD COLUMN IF NOT EXISTS "daily_download_count" integer NOT NULL DEFAULT 0
      `);
      await this.db.execute(sql`
        ALTER TABLE "zlib_credentials" ADD COLUMN IF NOT EXISTS "limit_hit_at" timestamp with time zone
      `);
      await this.db.execute(sql`
        CREATE TABLE IF NOT EXISTS "zlib_download_queue" (
          "id" serial PRIMARY KEY NOT NULL,
          "user_id" integer NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
          "zlib_book_id" varchar(100) NOT NULL,
          "hash" varchar(100) NOT NULL,
          "title" text NOT NULL,
          "author" text NOT NULL DEFAULT '',
          "extension" varchar(20) NOT NULL DEFAULT 'epub',
          "filename" text NOT NULL,
          "cover" text,
          "status" varchar(20) NOT NULL DEFAULT 'pending',
          "error_message" text,
          "book_dock_id" integer,
          "created_at" timestamp with time zone DEFAULT now() NOT NULL,
          "processed_at" timestamp with time zone
        )
      `);
      await this.db.execute(sql`
        CREATE INDEX IF NOT EXISTS "zlib_download_queue_user_status_idx" ON "zlib_download_queue" ("user_id", "status")
      `);
      await this.db.execute(sql`
        CREATE INDEX IF NOT EXISTS "zlib_download_queue_user_created_idx" ON "zlib_download_queue" ("user_id", "created_at")
      `);
    } catch (err) {
      this.logger.warn(`zlib_credentials table setup: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  async upsert(userId: number, email: string, remixUserId: string, remixUserKey: string, sessionCookies: string): Promise<void> {
    const encryptedKey = this.encrypt(remixUserKey);
    const existing = await this.db.select({ id: zlibCredentials.id }).from(zlibCredentials).where(eq(zlibCredentials.userId, userId)).limit(1);

    if (existing.length > 0) {
      await this.db
        .update(zlibCredentials)
        .set({ email, remixUserId, remixUserKey: encryptedKey, sessionCookies, updatedAt: new Date() })
        .where(eq(zlibCredentials.userId, userId));
    } else {
      await this.db.insert(zlibCredentials).values({ userId, email, remixUserId, remixUserKey: encryptedKey, sessionCookies });
    }
  }

  async findByUserId(userId: number): Promise<{
    email: string;
    remixUserId: string;
    remixUserKey: string;
    sessionCookies: string;
    dailyDownloadCount: number;
    limitHitAt: Date | null;
  } | null> {
    const rows = await this.db.select().from(zlibCredentials).where(eq(zlibCredentials.userId, userId)).limit(1);
    const row = rows[0];
    if (!row) return null;

    return {
      email: row.email,
      remixUserId: row.remixUserId,
      remixUserKey: this.decrypt(row.remixUserKey),
      sessionCookies: row.sessionCookies ?? '',
      dailyDownloadCount: row.dailyDownloadCount ?? 0,
      limitHitAt: row.limitHitAt ?? null,
    };
  }

  async incrementDownloadCount(userId: number): Promise<void> {
    await this.db
      .update(zlibCredentials)
      .set({
        dailyDownloadCount: sql`COALESCE(daily_download_count, 0) + 1`,
        updatedAt: new Date(),
      })
      .where(eq(zlibCredentials.userId, userId));
  }

  async markLimitHit(userId: number): Promise<void> {
    await this.db.update(zlibCredentials).set({ limitHitAt: new Date(), updatedAt: new Date() }).where(eq(zlibCredentials.userId, userId));
  }

  async resetDailyCount(userId: number): Promise<void> {
    await this.db
      .update(zlibCredentials)
      .set({ dailyDownloadCount: 0, limitHitAt: null, updatedAt: new Date() })
      .where(eq(zlibCredentials.userId, userId));
  }

  async resetCountIfExpired(userId: number, force = false): Promise<boolean> {
    const creds = await this.findByUserId(userId);
    if (!creds?.limitHitAt) return false;

    const elapsed = Date.now() - creds.limitHitAt.getTime();
    if (!force && elapsed < 24 * 60 * 60 * 1000) return false;

    await this.db
      .update(zlibCredentials)
      .set({ dailyDownloadCount: 0, limitHitAt: null, updatedAt: new Date() })
      .where(eq(zlibCredentials.userId, userId));
    return true;
  }

  async deleteByUserId(userId: number): Promise<void> {
    const result = await this.db.delete(zlibCredentials).where(eq(zlibCredentials.userId, userId)).returning({ id: zlibCredentials.id });
    if (result.length === 0) {
      throw new NotFoundException('Z-Library credentials not found');
    }
  }

  private encrypt(plaintext: string): string {
    if (!this.key) return plaintext;
    const iv = randomBytes(IV_LENGTH);
    const cipher = createCipheriv(ALGORITHM, this.key, iv);
    const encrypted = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
    const tag = cipher.getAuthTag();
    return Buffer.concat([iv, tag, encrypted]).toString('base64');
  }

  private decrypt(ciphertext: string): string {
    if (!this.key) return ciphertext;
    try {
      const buf = Buffer.from(ciphertext, 'base64');
      const iv = buf.subarray(0, IV_LENGTH);
      const tag = buf.subarray(IV_LENGTH, IV_LENGTH + TAG_LENGTH);
      const encrypted = buf.subarray(IV_LENGTH + TAG_LENGTH);
      const decipher = createDecipheriv(ALGORITHM, this.key, iv);
      decipher.setAuthTag(tag);
      return Buffer.concat([decipher.update(encrypted), decipher.final()]).toString('utf8');
    } catch {
      this.logger.warn('Failed to decrypt Z-Library key — returning as-is');
      return ciphertext;
    }
  }
}
