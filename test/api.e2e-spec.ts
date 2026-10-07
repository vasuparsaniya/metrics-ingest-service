import 'dotenv/config';
import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { NestExpressApplication } from '@nestjs/platform-express';
import { randomUUID } from 'node:crypto';
import { Server } from 'node:http';
import request from 'supertest';
import { applyMigrations } from '../scripts/migrate';
import { AppModule } from '../src/app.module';
import { readEnvironment } from '../src/config/environment';
import { DatabaseService } from '../src/database/database.service';
import { isRecord } from '../src/ingest/ingest.validation';
import { configureHttp } from '../src/http/configure-http';

describe('metrics APIs against real PostgreSQL', () => {
  let app: INestApplication;
  let server: Server;
  let database: DatabaseService;
  const token = 'api-test-token';
  const prefix = `api-test-${randomUUID()}`;
  const ids: string[] = [];
  const key = (): string => `${prefix}-${randomUUID()}`;
  const auth = `Bearer ${token}`;

  beforeAll(async () => {
    const url = process.env.TEST_DATABASE_URL;
    if (!url) throw new Error('TEST_DATABASE_URL is required');
    if (url === process.env.DATABASE_URL)
      throw new Error('API tests require a separate database');
    await applyMigrations(url);
    const module = await Test.createTestingModule({
      imports: [
        AppModule.register(
          readEnvironment({
            ...process.env,
            DATABASE_URL: url,
            API_TOKEN: token,
          }),
        ),
      ],
    }).compile();
    const application = module.createNestApplication<NestExpressApplication>();
    configureHttp(application);
    app = application;
    app.useLogger(false);
    await app.listen(0, '127.0.0.1');
    server = app.getHttpServer() as Server;
    database = app.get(DatabaseService);
  });

  afterAll(async () => {
    if (database) {
      await database.pool.query(
        'DELETE FROM measurements WHERE series_id = ANY($1::bigint[])',
        [ids],
      );
      await database.pool.query(
        'DELETE FROM series WHERE id = ANY($1::bigint[])',
        [ids],
      );
      await database.pool.query(
        'DELETE FROM ingest_requests WHERE idempotency_key LIKE $1',
        [`${prefix}%`],
      );
    }
    await app?.close();
  });

  async function createSeries(): Promise<string> {
    const result = await request(server)
      .post('/v1/series')
      .set('Authorization', auth)
      .send({ name: ` ${prefix} ` })
      .expect(201);
    const body: unknown = result.body;
    if (!isRecord(body) || typeof body.seriesId !== 'string')
      throw new Error('Series response is invalid');
    ids.push(body.seriesId);
    return body.seriesId;
  }

  function ingest(points: unknown[], idempotencyKey = key()) {
    return request(server)
      .post('/v1/ingest')
      .set('Authorization', auth)
      .set('Idempotency-Key', idempotencyKey)
      .send({ points });
  }

  it('creates trimmed non-unique names and rejects invalid names', async () => {
    const first = await createSeries();
    const second = await createSeries();
    expect(first).not.toBe(second);
    await request(server)
      .post('/v1/series')
      .set('Authorization', auth)
      .send({ name: ' ' })
      .expect(400);
    await request(server)
      .post('/v1/series')
      .set('Authorization', auth)
      .send({ name: 'x'.repeat(201) })
      .expect(400);
  });

  it('replays the original response, rejects key mismatch, and deduplicates across different keys', async () => {
    const id = await createSeries();
    const points = [
      {
        seriesId: id,
        ts: '2026-10-07T00:00:00.123456Z',
        value: '9007199254740993.123456789',
      },
    ];
    const identifier = key();
    const original = await ingest(points, identifier).expect(200);
    expect(original.body).toEqual({ accepted: 1, duplicates: 0, rejected: [] });
    const replay = await ingest(points, identifier).expect(200);
    expect(replay.body).toEqual(original.body);
    await ingest([{ ...points[0], value: '2' }], identifier).expect(409);
    const duplicate = await ingest(points).expect(200);
    expect(duplicate.body).toEqual({
      accepted: 0,
      duplicates: 1,
      rejected: [],
    });
    const latest = await request(server)
      .get(`/v1/series/${id}/latest`)
      .set('Authorization', auth)
      .expect(200);
    expect(latest.body).toEqual({
      seriesId: id,
      ts: '2026-10-07T00:00:00.123456Z',
      value: '9007199254740993.123456789',
    });
  });

  it('serializes same-key concurrent batches and preserves exact row count', async () => {
    const id = await createSeries();
    const points = Array.from({ length: 20 }, (_, index) => ({
      seriesId: id,
      ts: `2026-10-07T00:00:${String(index).padStart(2, '0')}Z`,
      value: String(index),
    }));
    const identifier = key();
    const [a, b] = await Promise.all([
      ingest(points, identifier),
      ingest(points, identifier),
    ]);
    expect(a.status).toBe(200);
    expect(b.status).toBe(200);
    expect(a.body).toEqual(b.body);
    expect(a.body).toEqual({ accepted: 20, duplicates: 0, rejected: [] });
    const count = await database.pool.query<{ count: string }>(
      'SELECT count(*)::text FROM measurements WHERE series_id=$1',
      [id],
    );
    expect(count.rows[0]?.count).toBe('20');
  });

  it('handles reversed-order overlapping batches with different keys without deadlock or double count', async () => {
    const id = await createSeries();
    const points = Array.from({ length: 30 }, (_, index) => ({
      seriesId: id,
      ts: `2026-10-07T00:01:${String(index).padStart(2, '0')}Z`,
      value: String(index),
    }));
    const [a, b] = await Promise.all([
      ingest(points),
      ingest([...points].reverse()),
    ]);
    expect(a.status).toBe(200);
    expect(b.status).toBe(200);
    const bodies: unknown[] = [a.body, b.body];
    const accepted = bodies.reduce<number>(
      (total, body) =>
        total +
        (isRecord(body) && typeof body.accepted === 'number'
          ? body.accepted
          : 0),
      0,
    );
    expect(accepted).toBe(30);
  });

  it('stores good rows and returns deterministic indexed errors for partial failure and internal conflicts', async () => {
    const id = await createSeries();
    const first = { seriesId: id, ts: '2026-10-07T10:00:00Z', value: '25.5' };
    const response = await ingest([
      first,
      { ...first, value: '25.50' },
      { ...first, value: '30' },
      { ...first, ts: 'bad' },
      { ...first, value: 2 },
      { ...first, seriesId: '9223372036854775807' },
    ]).expect(200);
    const body: unknown = response.body;
    expect(body).toMatchObject({ accepted: 1, duplicates: 1 });
    if (!isRecord(body) || !Array.isArray(body.rejected))
      throw new Error('Rejection response missing');
    expect(
      (body.rejected as unknown[]).map((row) =>
        isRecord(row) ? row.index : null,
      ),
    ).toEqual([2, 3, 4, 5]);
    const conflict = await ingest([{ ...first, value: '30' }, first]).expect(
      200,
    );
    expect(conflict.body).toMatchObject({
      accepted: 0,
      duplicates: 0,
      rejected: [{ index: 0 }, { index: 1 }],
    });
  });

  it('normalizes point identity across offsets and negative zero without losing microseconds', async () => {
    const id = await createSeries();
    const response = await ingest([
      { seriesId: id, ts: '2026-10-07T10:00:00.000001Z', value: '-0.00' },
      { seriesId: id, ts: '2026-10-07T15:30:00.000001+05:30', value: '0' },
      { seriesId: id, ts: '2026-10-07T10:00:00.000002Z', value: '-1.25' },
    ]).expect(200);
    expect(response.body).toEqual({ accepted: 2, duplicates: 1, rejected: [] });
  });

  it('disables JIT on application database connections', async () => {
    const setting = await database.pool.query<{ jit: string }>('SHOW jit');
    expect(setting.rows[0]?.jit).toBe('off');
  });

  it('keeps last distinct from maximum value and clips partial bucket boundaries', async () => {
    const id = await createSeries();
    await ingest([
      { seriesId: id, ts: '2026-10-07T10:00:00Z', value: '999' },
      { seriesId: id, ts: '2026-10-07T10:15:00Z', value: '17' },
      { seriesId: id, ts: '2026-10-07T10:59:59.999999Z', value: '-4.9' },
      { seriesId: id, ts: '2026-10-07T11:00:00Z', value: '23' },
      { seriesId: id, ts: '2026-10-07T11:10:00Z', value: '1000' },
    ]).expect(200);
    const result = await request(server)
      .get(`/v1/series/${id}/points`)
      .query({
        from: '2026-10-07T10:15:00Z',
        to: '2026-10-07T11:10:00Z',
        bucket: '1h',
      })
      .set('Authorization', auth)
      .expect(200);
    expect(result.body).toEqual([
      expect.objectContaining({
        count: 2,
        sum: '12.1',
        min: '-4.9',
        max: '17',
        last: { ts: '2026-10-07T10:59:59.999999Z', value: '-4.9' },
      }),
      expect.objectContaining({
        count: 1,
        sum: '23',
        last: { ts: '2026-10-07T11:00:00.000000Z', value: '23' },
      }),
    ]);
  });

  it('returns partial UTC buckets, empty null aggregates, late-arrival updates and latest by measurement time', async () => {
    const id = await createSeries();
    await ingest([
      { seriesId: id, ts: '2026-10-07T10:05:00Z', value: '100' },
      { seriesId: id, ts: '2026-10-07T10:15:00Z', value: '0.1' },
      { seriesId: id, ts: '2026-10-07T10:50:00.000001Z', value: '0.2' },
      { seriesId: id, ts: '2026-10-07T13:00:00Z', value: '9' },
    ]).expect(200);
    const url = `/v1/series/${id}/points`;
    const params = {
      from: '2026-10-07T10:15:00Z',
      to: '2026-10-07T13:00:00Z',
      bucket: '1h',
    };
    const before = await request(server)
      .get(url)
      .query(params)
      .set('Authorization', auth)
      .expect(200);
    expect(before.body).toEqual([
      {
        bucketStart: '2026-10-07T10:00:00.000000Z',
        count: 2,
        sum: '0.3',
        min: '0.1',
        max: '0.2',
        avg: '0.15000000000000000000',
        last: { ts: '2026-10-07T10:50:00.000001Z', value: '0.2' },
      },
      {
        bucketStart: '2026-10-07T11:00:00.000000Z',
        count: 0,
        sum: null,
        min: null,
        max: null,
        avg: null,
        last: null,
      },
      {
        bucketStart: '2026-10-07T12:00:00.000000Z',
        count: 0,
        sum: null,
        min: null,
        max: null,
        avg: null,
        last: null,
      },
    ]);
    await ingest([
      { seriesId: id, ts: '2026-10-07T10:20:00Z', value: '-0.3' },
    ]).expect(200);
    const after = await request(server)
      .get(url)
      .query(params)
      .set('Authorization', auth)
      .expect(200);
    expect(after.body).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          count: 3,
          sum: '0.0',
          min: '-0.3',
          last: { ts: '2026-10-07T10:50:00.000001Z', value: '0.2' },
        }),
      ]),
    );
    const latest = await request(server)
      .get(`/v1/series/${id}/latest`)
      .set('Authorization', auth)
      .expect(200);
    expect(latest.body).toMatchObject({
      ts: '2026-10-07T13:00:00.000000Z',
      value: '9',
    });
    for (const bucket of ['1m', '1d'])
      await request(server)
        .get(url)
        .query({ ...params, bucket })
        .set('Authorization', auth)
        .expect(200);
  });

  it('distinguishes empty and unknown series and returns exact stats coverage', async () => {
    const id = await createSeries();
    const empty = await request(server)
      .get(`/v1/series/${id}/latest`)
      .set('Authorization', auth)
      .expect(200);
    expect(empty.text).toBe('null');
    await request(server)
      .get('/v1/series/9223372036854775807/latest')
      .set('Authorization', auth)
      .expect(404);
    await request(server)
      .get(`/v1/series/${id}/points`)
      .set('Authorization', auth)
      .query({
        from: '2026-10-07T00:00:00Z',
        to: '2026-10-08T00:00:00Z',
        bucket: '2h',
      })
      .expect(400);
    const result = await request(server)
      .get('/v1/stats')
      .set('Authorization', auth)
      .expect(200);
    const body: unknown = result.body;
    if (!isRecord(body) || !Array.isArray(body.series))
      throw new Error('Invalid stats response');
    expect(body.series).toEqual(
      expect.arrayContaining([
        { seriesId: id, name: prefix, count: 0, from: null, to: null },
      ]),
    );
  });

  it('rejects missing keys and oversized batches before database processing', async () => {
    await request(server)
      .post('/v1/ingest')
      .set('Authorization', auth)
      .send({ points: [] })
      .expect(400);
    await ingest(Array.from({ length: 5001 }, () => null)).expect(413);
    await request(server)
      .post('/v1/ingest')
      .set('Authorization', auth)
      .set('Idempotency-Key', key())
      .send({ points: 'not an array' })
      .expect(400);
  });

  it('accepts 5000-point partial batches and preserves all good rows', async () => {
    const id = await createSeries();
    const points: unknown[] = Array.from({ length: 5000 }, (_, index) => ({
      seriesId: id,
      ts: `2026-10-07T00:00:00.${String(index).padStart(6, '0')}Z`,
      value: String(index),
    }));
    points[10] = { seriesId: id, ts: 'invalid', value: '10' };
    points[20] = {
      seriesId: id,
      ts: '2026-10-07T00:00:00.000020Z',
      value: 'not a number',
    };
    points[30] = {
      seriesId: '9223372036854775807',
      ts: '2026-10-07T00:00:00.000030Z',
      value: '30',
    };
    points[40] = points[0];
    const identifier = key();
    const result = await ingest(points, identifier).expect(200);
    expect(result.body).toMatchObject({
      accepted: 4996,
      duplicates: 1,
      rejected: [{ index: 10 }, { index: 20 }, { index: 30 }],
    });
    const replay = await ingest(points, identifier).expect(200);
    expect(replay.body).toEqual(result.body);
    const count = await database.pool.query<{ count: string }>(
      'SELECT count(*)::text FROM measurements WHERE series_id=$1',
      [id],
    );
    expect(count.rows[0]?.count).toBe('4996');
  });

  it('handles concurrent conflicting values without replacing the committed point', async () => {
    const id = await createSeries();
    const first = { seriesId: id, ts: '2026-10-07T00:00:00Z', value: '1' };
    const [a, b] = await Promise.all([
      ingest([first]),
      ingest([{ ...first, value: '2' }]),
    ]);
    expect(a.status).toBe(200);
    expect(b.status).toBe(200);
    const responses: unknown[] = [a.body, b.body];
    expect(responses).toEqual(
      expect.arrayContaining([
        { accepted: 1, duplicates: 0, rejected: [] },
        {
          accepted: 0,
          duplicates: 0,
          rejected: [
            {
              index: 0,
              reason: 'A point already exists with a different value',
            },
          ],
        },
      ]),
    );
    const count = await database.pool.query<{ count: string }>(
      'SELECT count(*)::text FROM measurements WHERE series_id=$1',
      [id],
    );
    expect(count.rows[0]?.count).toBe('1');
  });

  it('returns 409 for point-array reordering and replays property-order changes', async () => {
    const id = await createSeries();
    const first = { seriesId: id, ts: '2026-10-07T00:00:00Z', value: '1' };
    const second = { seriesId: id, ts: '2026-10-07T00:00:01Z', value: '2' };
    const identifier = key();
    const original = await ingest([first, second], identifier).expect(200);
    const replay = await ingest(
      [{ value: '1', ts: first.ts, seriesId: id }, second],
      identifier,
    ).expect(200);
    expect(replay.body).toEqual(original.body);
    await ingest([second, first], identifier).expect(409);
  });

  it('preserves expanded-year and native upper-bound timestamps without JavaScript Date conversion', async () => {
    const id = await createSeries();
    await ingest([
      { seriesId: id, ts: '0000-01-01T00:00:00Z', value: '1' },
      { seriesId: id, ts: '+010000-01-01T00:00:00.123456Z', value: '2' },
      { seriesId: id, ts: '+294276-12-31T23:59:59.999998Z', value: '3' },
    ]).expect(200);
    const latest = await request(server)
      .get(`/v1/series/${id}/latest`)
      .set('Authorization', auth)
      .expect(200);
    expect(latest.body).toMatchObject({
      ts: '+294276-12-31T23:59:59.999998Z',
      value: '3',
    });
    const buckets = await request(server)
      .get(`/v1/series/${id}/points`)
      .set('Authorization', auth)
      .query({
        from: '+294276-12-31T23:59:59.999997Z',
        to: '+294276-12-31T23:59:59.999999Z',
        bucket: '1h',
      })
      .expect(200);
    expect(buckets.body).toEqual(
      expect.arrayContaining([expect.objectContaining({ count: 1, sum: '3' })]),
    );
  });

  it('sheds overload while a competing transaction holds a request key', async () => {
    const id = await createSeries();
    const identifier = key();
    const blocker = await database.pool.connect();
    try {
      await blocker.query('BEGIN');
      await blocker.query(
        'INSERT INTO ingest_requests (idempotency_key, payload_hash) VALUES ($1, $2)',
        [identifier, Buffer.alloc(32)],
      );
      const outcomes = await Promise.all(
        Array.from({ length: 12 }, () =>
          ingest(
            [{ seriesId: id, ts: '2026-10-07T00:00:00Z', value: '1' }],
            identifier,
          ),
        ),
      );
      expect(outcomes.every((result) => result.status === 429)).toBe(true);
      expect(
        outcomes.every((result) => result.headers['retry-after'] === '1'),
      ).toBe(true);
    } finally {
      await blocker.query('ROLLBACK');
      blocker.release();
    }
    const result = await ingest(
      [{ seriesId: id, ts: '2026-10-07T00:00:00Z', value: '1' }],
      identifier,
    ).expect(200);
    expect(result.body).toEqual({ accepted: 1, duplicates: 0, rejected: [] });
  });
});
