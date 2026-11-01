import { join } from 'path';

import { readMigrationFiles, type MigrationMeta } from 'drizzle-orm/migrator';
import type { Pool } from 'pg';

import { dropUnreleasedMigrationRows, reconcileMigrationLedgerTimestamps } from './migration-ledger-compatibility';

const migrations = [
  { hash: 'first', folderMillis: 100 },
  { hash: 'second', folderMillis: 200 },
] as const satisfies readonly Pick<MigrationMeta, 'folderMillis' | 'hash'>[];

// Local fork 0053-0056 ledger rows from before the renumber.
const forkHashes = [
  'c190662c95f7d6bd0c43e617eb93874dfd84af025f5b41d13fc88996374bb1d8',
  'a3553d2bd0badb78a5c228eded5e381a7d03b75400dec6f92abd41790cfc1706',
  '825acca766e63ac3a80ed95ec19597191a136efe78f9d7c64491e2d147614fed',
  'd5dd9f7a687a87065a8999224076fa75e7a40eecf0acf092e1e8dd12196eb5d2',
  '3cfef0ffd7a3186eaf80feb23623940df7f046aec3deee4404a73289f4bb0ad2',
  '0e06a28ec1229ec5240b3a4ec1e4f1263e6eafaed69ac1effc0b4a14814d2d86',
  'f1b13f01fff86cfc90939e708a0dbd8c899b9a1d1d832ad0edcc7f8bad65323c',
  // 0125-0128 before the 2026-11-01 renumber to 0133-0136.
  '89b8926fe9e21a9ae0182365d3e38b899be8a8b2136d7449071e05db53060ebd',
  'a41b65e96a8da2b615e57c30b444d05ee9a4c29e69641123fadef3fdfac39ccc',
  '0528dcbca621b70bd4bdb7063ff1b0856028b4cc47a9ac302ced1c78b3e25c2b',
  '7348d127c77472c08314af36cdf17d0b2bc13456b103d76b126343efd5a62062',
];

function createPool(tableName: string | null, ledgerRows: Array<{ id: number; hash: string; createdAt: string }> = []) {
  const query = vi.fn((statement: string) => {
    if (statement.includes('to_regclass')) return Promise.resolve({ rows: [{ tableName }] });
    if (statement.includes('SELECT id, hash')) return Promise.resolve({ rows: ledgerRows });
    if (statement.startsWith('UPDATE') || statement.startsWith('DELETE')) return Promise.resolve({ rows: [], rowCount: 1 });
    return Promise.resolve({ rows: [], rowCount: 0 });
  });
  const release = vi.fn();
  const pool = { connect: vi.fn(() => Promise.resolve({ query, release })) } as unknown as Pick<Pool, 'connect'>;
  return { pool, query, release };
}

describe('reconcileMigrationLedgerTimestamps', () => {
  it('does nothing before Drizzle has created its ledger table', async () => {
    const { pool, query, release } = createPool(null);

    await expect(reconcileMigrationLedgerTimestamps(pool, migrations)).resolves.toEqual({ repairedRows: 0 });
    expect(query).toHaveBeenCalledTimes(4);
    expect(query).toHaveBeenNthCalledWith(1, 'BEGIN');
    expect(query).toHaveBeenLastCalledWith('COMMIT');
    expect(release).toHaveBeenCalledOnce();
  });

  it('repairs timestamps only when an applied migration hash is known and mismatched', async () => {
    const { pool, query } = createPool('drizzle.__drizzle_migrations', [
      { id: 7, hash: 'first', createdAt: '50' },
      { id: 8, hash: 'second', createdAt: '200' },
      { id: 9, hash: 'unknown', createdAt: '25' },
    ]);

    await expect(reconcileMigrationLedgerTimestamps(pool, migrations)).resolves.toEqual({ repairedRows: 1 });
    expect(query).toHaveBeenCalledWith('UPDATE drizzle.__drizzle_migrations SET created_at = $1 WHERE id = $2 AND hash = $3 AND created_at <> $1', [
      100,
      7,
      'first',
    ]);
    expect(query.mock.calls.filter(([statement]) => statement.startsWith('UPDATE'))).toHaveLength(1);
  });

  it('rolls back and releases the client when reconciliation fails', async () => {
    const query = vi
      .fn()
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [] })
      .mockRejectedValueOnce(new Error('ledger unavailable'))
      .mockResolvedValueOnce({ rows: [] });
    const release = vi.fn();
    const pool = { connect: vi.fn(() => Promise.resolve({ query, release })) } as unknown as Pick<Pool, 'connect'>;

    await expect(reconcileMigrationLedgerTimestamps(pool, migrations)).rejects.toThrow('ledger unavailable');
    expect(query).toHaveBeenLastCalledWith('ROLLBACK');
    expect(release).toHaveBeenCalledOnce();
  });
});

describe('dropUnreleasedMigrationRows', () => {
  const unreleasedIdentity = '1ec15e36d30f9bf4e79f92cb59eb461e5f76f53f43293d1b08a15253f22f35cf';

  it('drops the unreleased identity record so release migrations recorded before it still run', async () => {
    const { pool, query, release } = createPool('drizzle.__drizzle_migrations');

    await expect(dropUnreleasedMigrationRows(pool, migrations)).resolves.toEqual({ removedRows: 1 });
    expect(query).toHaveBeenCalledWith('DELETE FROM drizzle.__drizzle_migrations WHERE hash = ANY($1::text[])', [
      expect.arrayContaining([unreleasedIdentity]),
    ]);
    expect(query).toHaveBeenLastCalledWith('COMMIT');
    expect(release).toHaveBeenCalledOnce();
  });

  it('drops the pre-renumber local fork records against the real journal', async () => {
    const journal = readMigrationFiles({ migrationsFolder: join(__dirname, '..', 'db', 'migrations') });
    const { pool, query } = createPool('drizzle.__drizzle_migrations');

    await dropUnreleasedMigrationRows(pool, journal);
    expect(query).toHaveBeenCalledWith('DELETE FROM drizzle.__drizzle_migrations WHERE hash = ANY($1::text[])', [expect.arrayContaining(forkHashes)]);
  });

  it('does nothing before Drizzle has created its ledger table', async () => {
    const { pool, query } = createPool(null);

    await expect(dropUnreleasedMigrationRows(pool, migrations)).resolves.toEqual({ removedRows: 0 });
    expect(query.mock.calls.some(([statement]) => statement.startsWith('DELETE'))).toBe(false);
  });

  it('keeps a record the current journal owns', async () => {
    const { pool } = createPool('drizzle.__drizzle_migrations');

    await expect(
      dropUnreleasedMigrationRows(pool, [...migrations, { hash: unreleasedIdentity }, ...forkHashes.map((hash) => ({ hash }))]),
    ).resolves.toEqual({ removedRows: 0 });
    expect(pool.connect).not.toHaveBeenCalled();
  });

  it('rolls back and releases the client when the drop fails', async () => {
    const query = vi
      .fn()
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [] })
      .mockRejectedValueOnce(new Error('ledger unavailable'))
      .mockResolvedValueOnce({ rows: [] });
    const release = vi.fn();
    const pool = { connect: vi.fn(() => Promise.resolve({ query, release })) } as unknown as Pick<Pool, 'connect'>;

    await expect(dropUnreleasedMigrationRows(pool, migrations)).rejects.toThrow('ledger unavailable');
    expect(query).toHaveBeenLastCalledWith('ROLLBACK');
    expect(release).toHaveBeenCalledOnce();
  });
});
