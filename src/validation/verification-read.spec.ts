import { ApiClient, ApiTransportError } from '../../scripts/load/http';
import { VerificationReadClient } from '../../scripts/load/verification-read';
import { requestMetrics } from '../../scripts/load/metrics';

describe('read-only verification transport recovery', () => {
  afterEach(() => jest.restoreAllMocks());

  it('recovers one socket failure, retaining failed attempts outside latency benchmarks', async () => {
    const failure = new TypeError('fetch failed', {
      cause: Object.assign(new Error('socket closed'), {
        code: 'UND_ERR_SOCKET',
      }),
    });
    const fetch = jest
      .spyOn(globalThis, 'fetch')
      .mockRejectedValueOnce(failure)
      .mockResolvedValueOnce(new Response('[]'));
    const api = new VerificationReadClient('http://localhost', 'secret-token');
    const metrics = requestMetrics();
    await expect(api.request('/v1/series/1/points', metrics)).resolves.toEqual(
      [],
    );
    expect(fetch).toHaveBeenCalledTimes(2);
    expect(metrics.failed).toHaveLength(1);
    expect(metrics.retries).toBe(1);
    expect(api.evidence[0]).toMatchObject({
      recovered: true,
      passed: true,
      transportErrors: [{ code: 'UND_ERR_SOCKET' }],
      attempts: { failed: { samples: 1 }, success: { samples: 1 }, retries: 1 },
    });
  });

  it('bounds persistent transport failures and preserves route/code/cause', async () => {
    const cause = Object.assign(new Error('socket'), { code: 'ECONNRESET' });
    const fetch = jest
      .spyOn(globalThis, 'fetch')
      .mockRejectedValue(new TypeError('fetch failed', { cause }));
    const api = new VerificationReadClient('http://localhost', 'token');
    await expect(
      api.request('/v1/series/8/points', requestMetrics()),
    ).rejects.toThrow('ECONNRESET');
    expect(fetch).toHaveBeenCalledTimes(2);
    expect(api.evidence[0]).toMatchObject({
      route: '/v1/series/8/points',
      passed: false,
      recovered: false,
    });
  });

  it.each([429, 503, 500])(
    'does not retry HTTP %s or hide server failures',
    async (status) => {
      const fetch = jest
        .spyOn(globalThis, 'fetch')
        .mockResolvedValue(new Response('{"message":"busy"}', { status }));
      const api = new VerificationReadClient('http://localhost', 'token');
      await expect(api.request('/v1/stats', requestMetrics())).rejects.toThrow(
        String(status),
      );
      expect(fetch).toHaveBeenCalledTimes(1);
      expect(api.evidence[0]?.passed).toBe(false);
    },
  );

  it('refuses any write before calling fetch', async () => {
    const fetch = jest.spyOn(globalThis, 'fetch');
    const api = new VerificationReadClient('http://localhost', 'token');
    await expect(
      api.request('/v1/ingest', requestMetrics(), { points: [] }, 'key'),
    ).rejects.toThrow('read-only');
    expect(fetch).not.toHaveBeenCalled();
  });

  it('keeps measurement/write clients at zero retries while exposing transport diagnostics', async () => {
    const cause = Object.assign(new Error('socket'), {
      code: 'UND_ERR_SOCKET',
    });
    const failure = new TypeError('fetch failed', { cause });
    const fetch = jest.spyOn(globalThis, 'fetch').mockRejectedValue(failure);
    const api = new ApiClient('http://localhost', 'secret-token', 0);
    const promise = api.request(
      '/v1/ingest',
      requestMetrics(),
      { points: [] },
      'private-key',
    );
    await expect(promise).rejects.toBeInstanceOf(ApiTransportError);
    await expect(promise).rejects.toMatchObject({
      method: 'POST',
      route: '/v1/ingest',
      transportCode: 'UND_ERR_SOCKET',
      cause: failure,
    });
    expect(fetch).toHaveBeenCalledTimes(1);
    const error: unknown = await promise.catch((error: unknown) => error);
    expect(error instanceof Error && error.message).not.toContain(
      'secret-token',
    );
    expect(error instanceof Error && error.message).not.toContain(
      'private-key',
    );
  });
});
