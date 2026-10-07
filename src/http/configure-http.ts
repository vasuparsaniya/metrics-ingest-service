import { NestExpressApplication } from '@nestjs/platform-express';

/** Bounds body-parser allocation while allowing ordinary 5000-point batches. */
export function configureHttp(app: NestExpressApplication): void {
  // This transport ceiling protects process memory; it does not change NUMERIC precision.
  app.useBodyParser('json', { limit: '16mb' });
}
