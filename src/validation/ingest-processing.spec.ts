import { setImmediate as yieldToIo } from 'node:timers/promises';
import { createHash } from 'node:crypto';
import { groupPoints } from '../ingest/ingest.validation';
import { fingerprint } from '../ingest/ingest.fingerprint';
import { validatePointsCooperatively as validatePoints } from '../ingest/ingest.processing';

function points(length = 5000): unknown[] {
  return Array.from({ length }, (_, index) => ({
    seriesId: String((index % 8) + 1),
    ts: `2026-10-07T00:00:00.${String(index).padStart(6, '0')}Z`,
    value: '001.2500',
  }));
}

describe('cooperative batch processing', () => {
  it.each([0, 1, 249, 250, 251, 500, 5000])(
    'preserves canonical array separators and legacy hash bytes for %i points',
    async (length) => {
      // Generated property order already matches the legacy alphabetical key order.
      const body = { points: points(length) };
      const previous = createHash('sha256')
        .update(JSON.stringify(body))
        .digest();
      expect(await fingerprint(body)).toEqual(previous);
    },
  );

  it('lets an I/O callback run before a 5000-point fingerprint completes', async () => {
    let ran = false;
    const callback = yieldToIo().then(() => {
      ran = true;
    });
    const hash = await fingerprint({ points: points() });
    expect(hash).toHaveLength(32);
    const ranBeforeCompletion = ran;
    await callback;
    expect(ranBeforeCompletion).toBe(true);
  });

  it('lets an I/O callback run before 5000-point validation completes', async () => {
    let ran = false;
    const callback = yieldToIo().then(() => {
      ran = true;
    });
    const result = await validatePoints(points());
    expect(result.valid).toHaveLength(5000);
    const ranBeforeCompletion = ran;
    await callback;
    expect(ranBeforeCompletion).toBe(true);
  });

  it('keeps hashes compatible with existing saved request records', async () => {
    const body = {
      extra: {
        '2': 'two',
        '10': 'ten',
        nested: [null, true, 0, -0, 'é😀\ud800'],
      },
      points: [
        { seriesId: '01', ts: '2026-10-07T00:00:00.000001Z', value: '1.00' },
      ],
    };
    expect((await fingerprint(body)).toString('hex')).toBe(
      'da2f4c6f93b320ac3b8f8993b5d9ce94ace4713b511ab651b22575e6e97dfc6e',
    );
  });

  it('keeps original rejection indexes at and across chunk boundaries', async () => {
    const rows = points();
    const invalid = [249, 250, 499, 500, 4999];
    for (const index of invalid)
      rows[index] = { seriesId: '1', ts: 'bad', value: '1' };
    const result = await validatePoints(rows);
    expect(result.rejected.map((row) => row.index)).toEqual(invalid);
    expect(result.valid).toHaveLength(4995);
  });

  it('groups equal and conflicting identities across validation chunks', async () => {
    const rows = points(501);
    rows[0] = {
      seriesId: '0001',
      ts: '2026-10-07T00:00:00Z',
      value: '01.2500',
    };
    rows[250] = {
      seriesId: '1',
      ts: '2026-10-07T05:30:00+05:30',
      value: '1.25',
    };
    rows[500] = {
      seriesId: '1',
      ts: '2026-10-07T00:00:00.000000Z',
      value: '-1.25',
    };
    const result = await validatePoints(rows);
    const groups = groupPoints(result.valid, result.rejected);
    expect(groups[0]?.indexes).toEqual([0, 250]);
    expect(result.rejected).toEqual([
      {
        index: 500,
        reason: 'Conflicting value for the same point within the batch',
      },
    ]);
  });

  it('keeps numeric identity lock ordering without JS Number conversions', async () => {
    const ids = ['9223372036854775807', '10', '2', '9007199254740993', '9'];
    const result = await validatePoints(
      ids.map((seriesId) => ({
        seriesId,
        ts: '2026-10-07T00:00:00Z',
        value: '0',
      })),
    );
    expect(
      groupPoints(result.valid, result.rejected).map(
        (group) => group.point.seriesId,
      ),
    ).toEqual(['2', '9', '10', '9007199254740993', '9223372036854775807']);
  });

  it('does not let request-local caching skip invalid rows or leak across batches', async () => {
    const bad = {
      seriesId: '9223372036854775808',
      ts: '2026-10-07T00:00:00Z',
      value: '1',
    };
    const first = await validatePoints(Array.from({ length: 501 }, () => bad));
    expect(first.valid).toEqual([]);
    expect(first.rejected.map((row) => row.index)).toEqual(
      Array.from({ length: 501 }, (_, index) => index),
    );
    const second = await validatePoints([
      { ...bad, seriesId: '9223372036854775807' },
    ]);
    expect(second.rejected).toEqual([]);
    expect(second.valid[0]?.index).toBe(0);
    const decimals = await validatePoints([
      { ...bad, seriesId: '1', value: 'NaN' },
      { ...bad, seriesId: '1', value: 'NaN' },
      { ...bad, seriesId: '1', value: '-0.000' },
      { ...bad, seriesId: '1', value: '-0.000' },
    ]);
    expect(decimals.rejected.map((row) => row.index)).toEqual([0, 1]);
    expect(decimals.valid.map((row) => row.value)).toEqual(['0', '0']);
  });

  it('rejects non-JSON fingerprint inputs rather than hashing missing data', async () => {
    await expect(fingerprint({ points: [undefined] })).rejects.toThrow(
      'JSON values',
    );
  });
});
