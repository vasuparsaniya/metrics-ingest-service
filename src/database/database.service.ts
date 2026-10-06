import {
  Inject,
  Injectable,
  Logger,
  OnApplicationShutdown,
} from '@nestjs/common';
import { Pool } from 'pg';
import { Environment } from '../config/environment';

/** Owns the process-wide PostgreSQL pool and closes it during graceful shutdown. */
@Injectable()
export class DatabaseService implements OnApplicationShutdown {
  readonly pool: Pool;
  private readonly logger = new Logger(DatabaseService.name);

  constructor(@Inject('ENVIRONMENT') environment: Environment) {
    this.pool = new Pool({
      connectionString: environment.databaseUrl,
      max: environment.poolMax,
      connectionTimeoutMillis: environment.connectTimeoutMs,
      idleTimeoutMillis: 30000,
      statement_timeout: environment.statementTimeoutMs,
      application_name: 'metrics-ingest-service',
    });
    this.pool.on('error', (error: Error) => {
      this.logger.error({
        event: 'database_idle_connection_error',
        outcome: 'failed',
        errorType: error.name,
      });
    });
  }

  async onApplicationShutdown(): Promise<void> {
    await this.pool.end();
  }
}
