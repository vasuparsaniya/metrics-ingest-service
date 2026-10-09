import 'reflect-metadata';
import 'dotenv/config';
import { ConsoleLogger } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { NestExpressApplication } from '@nestjs/platform-express';
import { AppModule } from './app.module';
import { readEnvironment } from './config/environment';
import { configureHttp } from './http/configure-http';

async function bootstrap(): Promise<void> {
  const environment = readEnvironment(process.env);
  const app = await NestFactory.create<NestExpressApplication>(
    AppModule.register(environment),
    {
      logger: new ConsoleLogger({ json: true }),
    },
  );
  configureHttp(app);
  app.enableShutdownHooks();
  await app.listen(environment.port, '127.0.0.1');
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
