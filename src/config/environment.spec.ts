import { readEnvironment } from './environment';

const valid = {
  DATABASE_URL: 'postgresql://localhost/metrics',
  API_TOKEN: 'test-token',
};

describe('runtime configuration', () => {
  it('rejects missing database settings before accepting requests', () => {
    expect(() => readEnvironment({ API_TOKEN: 'token' })).toThrow(
      'DATABASE_URL',
    );
  });
  it('rejects a non-PostgreSQL connection URL', () => {
    expect(() =>
      readEnvironment({ ...valid, DATABASE_URL: 'https://localhost/db' }),
    ).toThrow('PostgreSQL');
  });
  it.each(['0', '-1', '1.5', '12x', '101'])(
    'rejects invalid pool size %s',
    (poolMax) => {
      expect(() => readEnvironment({ ...valid, DB_POOL_MAX: poolMax })).toThrow(
        'DB_POOL_MAX',
      );
    },
  );
  it('rejects an empty bearer token', () => {
    expect(() => readEnvironment({ ...valid, API_TOKEN: '' })).toThrow(
      'API_TOKEN',
    );
  });
  it('accepts valid settings with bounded defaults', () => {
    expect(readEnvironment(valid).poolMax).toBe(12);
  });
});
