import { HttpException, Inject, Injectable, Logger } from '@nestjs/common';
import { Environment } from '../config/environment';
import { IngestRepository } from './ingest.repository';
import { batchBody } from './ingest.validation';
import { fingerprint } from './ingest.fingerprint';
import { IngestResponse } from './ingest.types';

/** Sheds ingestion above available writer capacity instead of accumulating a queue. */
@Injectable()
export class IngestService {
  private active = 0;
  private readonly limit: number;
  private readonly logger = new Logger(IngestService.name);

  constructor(
    private readonly repository: IngestRepository,
    @Inject('ENVIRONMENT') environment: Environment,
  ) {
    this.limit = Math.max(1, environment.poolMax - 4);
  }

  async ingest(key: string, body: unknown): Promise<IngestResponse> {
    const rows = batchBody(body);
    if (this.active >= this.limit)
      throw new HttpException('Ingestion is busy; retry the request', 429);
    this.active += 1;
    const start = performance.now();
    try {
      const hash = await fingerprint(body);
      const result = await this.repository.ingest(key, hash, rows);
      this.logger.log({
        event: 'ingest',
        key,
        inputCount: rows.length,
        accepted: result.response.accepted,
        duplicates: result.response.duplicates,
        rejectedCount: result.response.rejected.length,
        durationMs: performance.now() - start,
        replayed: result.replayed,
        outcome: 'committed',
      });
      return result.response;
    } catch (error: unknown) {
      this.logger.warn({
        event: 'ingest',
        key,
        inputCount: rows.length,
        durationMs: performance.now() - start,
        outcome: 'failed',
      });
      throw error;
    } finally {
      this.active -= 1;
    }
  }
}
