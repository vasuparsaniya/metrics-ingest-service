import 'reflect-metadata';
import 'dotenv/config';
import { ConsoleLogger } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { NestExpressApplication } from '@nestjs/platform-express';
import { readEnvironment } from '../config/environment';
import { configureHttp } from '../http/configure-http';
import { DatabaseService } from '../database/database.service';
import { IndexHttpModule } from './index-http-module';
import {
  assertIndexHttpSchema,
  guardIndexHttpDatabase,
} from './index-http-schema';

async function bootstrap(): Promise<void> {
  const environment = readEnvironment(process.env);
  guardIndexHttpDatabase(
    environment.databaseUrl,
    process.env.METRICS_MAIN_DATABASE_URL,
  );
  const variant = process.env.METRICS_INDEX_HTTP_VARIANT;
  if (variant !== 'indexed' && variant !== 'unindexed')
    throw new Error('METRICS_INDEX_HTTP_VARIANT must be indexed or unindexed');
  const app = await NestFactory.create<NestExpressApplication>(
    IndexHttpModule.register(environment),
    { logger: new ConsoleLogger({ json: true }) },
  );
  try {
    await assertIndexHttpSchema(app.get(DatabaseService).pool, variant);
    configureHttp(app);
    app.enableShutdownHooks();
    await app.listen(environment.port, '127.0.0.1');
  } catch (error: unknown) {
    await app.close();
    throw error;
  }
}

void bootstrap().catch((error: unknown) => {
  console.error(
    JSON.stringify({
      event: 'startup_failed',
      outcome: 'failed',
      errorType: error instanceof Error ? error.name : 'UnknownError',
    }),
  );
  process.exitCode = 1;
});
