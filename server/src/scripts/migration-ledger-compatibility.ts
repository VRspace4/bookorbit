import type { MigrationMeta } from 'drizzle-orm/migrator';
import type { Pool } from 'pg';

import { sanitizeLogValue } from '../common/utils/log-sanitize.utils';

type CompatibilityResult = {
  repairedRows: number;
};

/**
 * Ledger rows written by builds that never shipped. Drizzle applies only migrations newer than the
 * newest recorded one, so a row recorded after release migrations its build never had hides those
 * migrations for good. A hash belongs here only when a released migration recreates its effect
 * idempotently, which makes dropping the row safe.
 */
const UNRELEASED_MIGRATION_HASHES = [
  // `server_identity`, created by local connection-address builds before
  // 0112_add_server_connection_identity, which creates the same table if it is missing.
  '1ec15e36d30f9bf4e79f92cb59eb461e5f76f53f43293d1b08a15253f22f35cf',
  // Local fork 0053-0056, recorded before upstream 0053-0124 existed. Their rows sort after
  // upstream 0053 and would hide it; 0125-0127 recreate them idempotently.
  'c190662c95f7d6bd0c43e617eb93874dfd84af025f5b41d13fc88996374bb1d8',
  'a3553d2bd0badb78a5c228eded5e381a7d03b75400dec6f92abd41790cfc1706',
  '825acca766e63ac3a80ed95ec19597191a136efe78f9d7c64491e2d147614fed',
  'd5dd9f7a687a87065a8999224076fa75e7a40eecf0acf092e1e8dd12196eb5d2',
  '3cfef0ffd7a3186eaf80feb23623940df7f046aec3deee4404a73289f4bb0ad2',
  '0e06a28ec1229ec5240b3a4ec1e4f1263e6eafaed69ac1effc0b4a14814d2d86',
  'f1b13f01fff86cfc90939e708a0dbd8c899b9a1d1d832ad0edcc7f8bad65323c',
] as const;

export async function dropUnreleasedMigrationRows(
  pool: Pick<Pool, 'connect'>,
  migrations: readonly Pick<MigrationMeta, 'hash'>[],
): Promise<{ removedRows: number }> {
  const known = new Set(migrations.map((migration) => migration.hash));
  const hashes = UNRELEASED_MIGRATION_HASHES.filter((hash) => !known.has(hash));
  if (hashes.length === 0) return { removedRows: 0 };

  const client = await pool.connect();
  const startedAt = Date.now();
  try {
    await client.query('BEGIN');
    await client.query(`SELECT pg_advisory_xact_lock(hashtext('bookorbit'), hashtext('migration-ledger-compatibility'))`);
    const table = await client.query<{ tableName: string | null }>(`SELECT to_regclass('drizzle.__drizzle_migrations')::text AS "tableName"`);
    if (table.rows[0]?.tableName === null || table.rows.length === 0) {
      await client.query('COMMIT');
      return { removedRows: 0 };
    }
    const removed = await client.query(`DELETE FROM drizzle.__drizzle_migrations WHERE hash = ANY($1::text[])`, [hashes]);
    await client.query('COMMIT');
    const removedRows = removed.rowCount ?? 0;
    if (removedRows > 0) {
      console.warn(
        `[db.migration-ledger-compatibility] [end] durationMs=${Date.now() - startedAt} removed=${removedRows} - unreleased migration records dropped`,
      );
    }
    return { removedRows };
  } catch (error) {
    await client.query('ROLLBACK');
    const errorClass = error instanceof Error ? error.name : typeof error;
    const message = error instanceof Error ? error.message : String(error);
    console.error(
      `[db.migration-ledger-compatibility] [fail] durationMs=${Date.now() - startedAt} errorClass=${errorClass} error="${sanitizeLogValue(message)}" - unreleased migration records could not be dropped`,
    );
    throw error;
  } finally {
    client.release();
  }
}

type LedgerRow = {
  id: number;
  hash: string;
  createdAt: string;
};

export async function reconcileMigrationLedgerTimestamps(
  pool: Pick<Pool, 'connect'>,
  migrations: readonly Pick<MigrationMeta, 'folderMillis' | 'hash'>[],
): Promise<CompatibilityResult> {
  const client = await pool.connect();
  const startedAt = Date.now();

  try {
    await client.query('BEGIN');
    await client.query(`SELECT pg_advisory_xact_lock(hashtext('bookorbit'), hashtext('migration-ledger-compatibility'))`);
    const table = await client.query<{ tableName: string | null }>(`SELECT to_regclass('drizzle.__drizzle_migrations')::text AS "tableName"`);
    if (table.rows[0]?.tableName === null || table.rows.length === 0) {
      await client.query('COMMIT');
      return { repairedRows: 0 };
    }

    const expectedTimestamps = new Map(migrations.map((migration) => [migration.hash, migration.folderMillis]));
    const ledger = await client.query<LedgerRow>(`
      SELECT id, hash, created_at::text AS "createdAt"
      FROM drizzle.__drizzle_migrations
      ORDER BY id
    `);

    let repairedRows = 0;
    for (const row of ledger.rows) {
      const expected = expectedTimestamps.get(row.hash);
      if (expected === undefined || row.createdAt === String(expected)) continue;
      const updated = await client.query(`UPDATE drizzle.__drizzle_migrations SET created_at = $1 WHERE id = $2 AND hash = $3 AND created_at <> $1`, [
        expected,
        row.id,
        row.hash,
      ]);
      repairedRows += updated.rowCount ?? 0;
    }

    await client.query('COMMIT');
    if (repairedRows > 0) {
      console.warn(
        `[db.migration-ledger-compatibility] [end] durationMs=${Date.now() - startedAt} repaired=${repairedRows} - applied migration timestamps reconciled`,
      );
    }
    return { repairedRows };
  } catch (error) {
    await client.query('ROLLBACK');
    const errorClass = error instanceof Error ? error.name : typeof error;
    const message = error instanceof Error ? error.message : String(error);
    console.error(
      `[db.migration-ledger-compatibility] [fail] durationMs=${Date.now() - startedAt} errorClass=${errorClass} error="${sanitizeLogValue(message)}" - applied migration timestamps could not be reconciled`,
    );
    throw error;
  } finally {
    client.release();
  }
}
