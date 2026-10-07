import { PoolClient } from 'pg';
import { DatabaseService } from '../database/database.service';
import { IngestRepository } from './ingest.repository';

describe('fresh-insert classification fast path', () => {
  const point = (second: number, value = '1') => ({
    seriesId: '1',
    ts: `2026-10-07T00:00:0${second}Z`,
    value,
  });

  function fixture(
    inserted: number,
    stored?: { ordinal: string; identity: string; equal: boolean }[],
  ) {
    const query = jest
      .fn<
        Promise<{ rows: unknown[]; rowCount: number }>,
        [string, unknown[]?]
      >()
      .mockResolvedValue({ rows: [], rowCount: 1 });
    query.mockResolvedValueOnce({ rows: [], rowCount: 1 });
    query.mockResolvedValueOnce({ rows: [{ id: '1' }], rowCount: 1 });
    query.mockResolvedValueOnce({
      rows: Array.from({ length: inserted }, (_, index) => ({
        series_id: '1',
        ts: String(index),
      })),
      rowCount: inserted,
    });
    if (stored)
      query.mockResolvedValueOnce({ rows: stored, rowCount: stored.length });
    const client = { query } as unknown as PoolClient;
    const transaction = jest.fn(
      async (operation: (connection: PoolClient) => Promise<unknown>) =>
        operation(client),
    );
    const repository = new IngestRepository({
      transaction,
    } as unknown as DatabaseService);
    return { repository, query, transaction };
  }

  it('omits the classification SELECT when all candidates were inserted', async () => {
    const { repository, query, transaction } = fixture(2);
    const result = await repository.ingest('fresh', Buffer.alloc(32), [
      point(0),
      point(1),
    ]);
    expect(result).toEqual({
      response: { accepted: 2, duplicates: 0, rejected: [] },
      replayed: false,
    });
    expect(query).toHaveBeenCalledTimes(4);
    expect(
      query.mock.calls.some(([sql]) => String(sql).includes('WITH ORDINALITY')),
    ).toBe(false);
    expect(String(query.mock.calls[3]?.[0])).toContain(
      'UPDATE ingest_requests',
    );
    expect(transaction).toHaveBeenCalledTimes(1);
  });

  it('counts intra-batch duplicates without reading newly inserted points again', async () => {
    const { repository, query } = fixture(2);
    const result = await repository.ingest('duplicates', Buffer.alloc(32), [
      point(0),
      point(0, '1.00'),
      point(1),
    ]);
    expect(result.response).toEqual({
      accepted: 2,
      duplicates: 1,
      rejected: [],
    });
    expect(query).toHaveBeenCalledTimes(4);
  });

  it('preserves invalid and intra-batch conflict rejections on the fast path', async () => {
    const { repository, query } = fixture(1);
    const result = await repository.ingest('partial', Buffer.alloc(32), [
      point(0),
      point(0, '2'),
      point(1, 'invalid'),
    ]);
    expect(result.response.accepted).toBe(1);
    expect(result.response.duplicates).toBe(0);
    expect(result.response.rejected.map(({ index }) => index)).toEqual([1, 2]);
    expect(query).toHaveBeenCalledTimes(4);
  });

  it('keeps classification for a mix of fresh, duplicate and conflicting candidates', async () => {
    const { repository, query } = fixture(1, [
      { ordinal: '1', identity: '1:0', equal: true },
      { ordinal: '2', identity: '1:existing', equal: true },
      { ordinal: '3', identity: '1:conflicting', equal: false },
    ]);
    const result = await repository.ingest('mixed', Buffer.alloc(32), [
      point(0),
      point(1),
      point(2),
    ]);
    expect(result.response).toEqual({
      accepted: 1,
      duplicates: 1,
      rejected: [
        { index: 2, reason: 'A point already exists with a different value' },
      ],
    });
    expect(query).toHaveBeenCalledTimes(5);
    expect(String(query.mock.calls[3]?.[0])).toContain('WITH ORDINALITY');
  });

  it('keeps classification when every candidate already exists', async () => {
    const { repository, query } = fixture(0, [
      { ordinal: '1', identity: '1:existing', equal: true },
    ]);
    const result = await repository.ingest('existing', Buffer.alloc(32), [
      point(0),
      point(0),
    ]);
    expect(result.response).toEqual({
      accepted: 0,
      duplicates: 2,
      rejected: [],
    });
    expect(query).toHaveBeenCalledTimes(5);
  });
});
