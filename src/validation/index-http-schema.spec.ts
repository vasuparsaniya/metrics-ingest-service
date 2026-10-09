import { guardIndexHttpDatabase } from '../benchmark/index-http-schema';
import { indexHttpInsertSql } from '../benchmark/index-http-repository';

describe('index HTTP experiment isolation', () => {
  it('accepts only a local dedicated database', () => {
    expect(
      guardIndexHttpDatabase(
        'postgres://u:p@127.0.0.1/metrics_index_http_test',
      ),
    ).toBe('metrics_index_http_test');
    for (const url of [
      'postgres://u:p@example.com/metrics_index_http_test',
      'postgres://u:p@localhost/metrics',
      'https://localhost/metrics_index_http_test',
      'postgres://localhost/metrics_index_http_' + 'a'.repeat(64),
    ]) {
      expect(() => guardIndexHttpDatabase(url)).toThrow();
    }
  });
  it('refuses the main database even through another localhost spelling', () => {
    expect(() =>
      guardIndexHttpDatabase(
        'postgres://localhost/metrics_index_http_test',
        'postgres://127.0.0.1/metrics_index_http_test',
      ),
    ).toThrow();
  });
  it('uses ordered plain insertion without conflict handling', () => {
    expect(indexHttpInsertSql).toMatch(/ORDER BY series_id, ts/);
    expect(indexHttpInsertSql).not.toMatch(/ON CONFLICT/i);
  });
});
