import {
  Controller,
  Get,
  Logger,
  ServiceUnavailableException,
} from '@nestjs/common';
import { DatabaseService } from '../database/database.service';

/** Separates process liveness from the ability to serve database-backed requests. */
@Controller()
export class HealthController {
  private readonly logger = new Logger(HealthController.name);

  constructor(private readonly database: DatabaseService) {}

  @Get('healthz')
  health(): { status: string } {
    return { status: 'ok' };
  }

  @Get('readyz')
  async ready(): Promise<{ status: string }> {
    try {
      await this.database.pool.query('SELECT 1');
      return { status: 'ready' };
    } catch (error: unknown) {
      this.logger.warn({
        event: 'readiness_check',
        outcome: 'failed',
        errorType: error instanceof Error ? error.name : 'UnknownError',
      });
      throw new ServiceUnavailableException('Database is unavailable');
    }
  }
}
