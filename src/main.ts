import 'reflect-metadata';
import 'dotenv/config';
import { ConsoleLogger } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { readEnvironment } from './config/environment';

async function bootstrap(): Promise<void> {
  const environment = readEnvironment(process.env);
  const app = await NestFactory.create(AppModule.register(environment), {
    logger: new ConsoleLogger({ json: true }),
  });
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
