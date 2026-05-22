import { index, integer, pgTable, serial, text, timestamp, uniqueIndex, varchar } from 'drizzle-orm/pg-core';

import { users } from './auth';

export const zlibCredentials = pgTable(
  'zlib_credentials',
  {
    id: serial('id').primaryKey(),
    userId: integer('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    email: varchar('email', { length: 255 }).notNull(),
    remixUserId: varchar('remix_user_id', { length: 100 }).notNull(),
    remixUserKey: text('remix_user_key').notNull(), // encrypted AES-256-GCM
    sessionCookies: text('session_cookies').notNull().default(''),
    dailyDownloadCount: integer('daily_download_count').notNull().default(0),
    limitHitAt: timestamp('limit_hit_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .defaultNow()
      .notNull()
      .$onUpdateFn(() => new Date()),
  },
  (t) => [uniqueIndex('zlib_credentials_user_id_uidx').on(t.userId), index('zlib_credentials_user_id_idx').on(t.userId)],
);

export type ZlibCredential = typeof zlibCredentials.$inferSelect;
export type NewZlibCredential = typeof zlibCredentials.$inferInsert;

export const zlibDownloadQueue = pgTable(
  'zlib_download_queue',
  {
    id: serial('id').primaryKey(),
    userId: integer('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    zlibBookId: varchar('zlib_book_id', { length: 100 }).notNull(),
    hash: varchar('hash', { length: 100 }).notNull(),
    title: text('title').notNull(),
    author: text('author').notNull().default(''),
    extension: varchar('extension', { length: 20 }).notNull().default('epub'),
    filename: text('filename').notNull(),
    cover: text('cover'),
    status: varchar('status', { length: 20 }).notNull().default('pending'),
    errorMessage: text('error_message'),
    bookDockId: integer('book_dock_id'),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    processedAt: timestamp('processed_at', { withTimezone: true }),
  },
  (t) => [
    index('zlib_download_queue_user_status_idx').on(t.userId, t.status),
    index('zlib_download_queue_user_created_idx').on(t.userId, t.createdAt),
  ],
);

export type ZlibDownloadQueueItem = typeof zlibDownloadQueue.$inferSelect;
export type NewZlibDownloadQueueItem = typeof zlibDownloadQueue.$inferInsert;
