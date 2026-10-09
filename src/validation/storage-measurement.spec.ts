import {
  storageSummary,
  storageMarkdown,
  storageArguments,
  storageDatabase,
} from '../../scripts/load/storage';

describe('storage measurement', () => {
  const snapshot = {
    observedAt: '2026-10-09T00:00:00Z',
    serverStartedAt: 'same',
    databaseBytes: '9007199254740993',
    walRetainedBytes: '100',
    walInsertLsn: '0/1',
    relations: [],
  };
  it('keeps exact byte arithmetic beyond JS safe integers', () => {
    const result = storageSummary(
      snapshot,
      {
        ...snapshot,
        databaseBytes: '9007199254740995',
        walRetainedBytes: '90',
      },
      '12',
    );
    expect(result.databaseGrowthBytes).toBe('2');
    expect(result.walRetainedGrowthBytes).toBe('-10');
    expect(result.databasePlusClusterWalBytes).toBe('9007199254741085');
  });
  it('does not fabricate after sizes', () => {
    expect(storageSummary(snapshot, null, null).databaseGrowthBytes).toBeNull();
    expect(storageMarkdown(snapshot, null, null, 'load failed')).toContain(
      'load failed',
    );
    expect(storageMarkdown(snapshot, null, null, 'load failed')).toContain(
      'unavailable',
    );
  });
  it('rejects a restart or negative WAL difference', () => {
    expect(() =>
      storageSummary(
        snapshot,
        { ...snapshot, serverStartedAt: 'different' },
        '1',
      ),
    ).toThrow();
    expect(() => storageSummary(snapshot, snapshot, '-1')).toThrow();
  });
  it('requires explicit exclusive-cluster confirmation', () => {
    expect(() => storageArguments(['--database', 'test_db'])).toThrow();
    expect(
      storageArguments(['--database', 'test_db', '--confirm-exclusive-cluster'])
        .database,
    ).toBe('test_db');
    expect(storageArguments(['--help']).help).toBe(true);
  });
  it('rejects remote or main databases', () => {
    const env = {
      DATABASE_URL: 'postgres://user:secret@localhost:5433/metrics',
    };
    expect(() => storageDatabase(env, 'metrics')).toThrow();
    expect(() =>
      storageDatabase(
        { DATABASE_URL: 'postgres://user:secret@remote/metrics' },
        'test_db',
      ),
    ).toThrow();
  });
  it('rejects replay and ambiguous confirmations', () => {
    expect(() =>
      storageArguments([
        '--database',
        'test_db',
        '--manifest',
        'old.json',
        '--confirm-exclusive-cluster',
      ]),
    ).toThrow();
    expect(() =>
      storageArguments([
        '--database',
        'test_db',
        '--confirm-exclusive-cluster',
        '--confirm-exclusive-cluster',
      ]),
    ).toThrow();
  });
});
