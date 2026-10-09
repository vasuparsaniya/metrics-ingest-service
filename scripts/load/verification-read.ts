import { setTimeout as delay } from 'node:timers/promises';
import { ApiClient, ApiTransportError } from './http';
import { summarize } from './metrics';
import { RequestMetrics } from './types';

/** Separates recovered verification transport failures from measured latency evidence. */
export interface VerificationReadEvidence {
  route: string;
  passed: boolean;
  recovered: boolean;
  attempts: ReturnType<typeof summarize>;
  transportErrors: { code: string | null; message: string }[];
}

/** Allows one transport-only GET retry outside timed workloads; cannot submit writes. */
export class VerificationReadClient extends ApiClient {
  readonly evidence: VerificationReadEvidence[] = [];

  constructor(url: string, token: string) {
    super(url, token, 0);
  }

  override async request(
    path: string,
    metrics: RequestMetrics,
    body?: unknown,
    key?: string,
  ): Promise<unknown> {
    if (body !== undefined || key !== undefined)
      throw new Error('Verification client is read-only');
    const transportErrors: VerificationReadEvidence['transportErrors'] = [];
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        const result = await super.request(
          path,
          metrics,
          undefined,
          undefined,
          0,
        );
        this.evidence.push({
          route: path.split('?')[0] ?? path,
          passed: true,
          recovered: attempt > 0,
          attempts: summarize(metrics),
          transportErrors,
        });
        return result;
      } catch (failure: unknown) {
        if (failure instanceof ApiTransportError)
          transportErrors.push({
            code: failure.transportCode,
            message: failure.message,
          });
        if (!(failure instanceof ApiTransportError) || attempt === 1) {
          this.evidence.push({
            route: path.split('?')[0] ?? path,
            passed: false,
            recovered: false,
            attempts: summarize(metrics),
            transportErrors,
          });
          throw failure;
        }
        metrics.retries++;
        await delay(100);
      }
    }
    throw new Error('Verification retry boundary exceeded');
  }
}
