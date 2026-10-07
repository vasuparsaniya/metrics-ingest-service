import {
  Inject,
  Injectable,
  Logger,
  OnApplicationShutdown,
} from '@nestjs/common';
import { Pool, PoolClient } from 'pg';
import { Environment } from '../config/environment';
import { postgresSessionOptions } from './session-options';

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
      options: postgresSessionOptions,
    });
    this.pool.on('error', (error: Error) => {
      this.logger.error({
        event: 'database_idle_connection_error',
        outcome: 'failed',
        errorType: error.name,
      });
    });
  }

  /** Runs batch changes on one connection and rolls back all effects on failure. */
  async transaction<T>(
    operation: (client: PoolClient) => Promise<T>,
  ): Promise<T> {
    const client = await this.pool.connect();
    let releaseError: Error | undefined;
    try {
      await client.query('BEGIN ISOLATION LEVEL READ COMMITTED');
      await client.query("SET LOCAL lock_timeout = '2s'");
      const result = await operation(client);
      await client.query('COMMIT');
      return result;
    } catch (error: unknown) {
      try {
        await client.query('ROLLBACK');
      } catch (rollbackError: unknown) {
        releaseError =
          rollbackError instanceof Error
            ? rollbackError
            : new Error('Rollback failed');
        this.logger.error({
          event: 'rollback_failed',
          outcome: 'failed',
          errorType: releaseError.name,
        });
      }
      throw error;
    } finally {
      client.release(releaseError);
    }
  }

  async onApplicationShutdown(): Promise<void> {
    await this.pool.end();
  }
}
