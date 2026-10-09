import { Module } from '@nestjs/common';
import { HealthController } from './health.controller';

/** Registers process and database health endpoints. */
@Module({ controllers: [HealthController] })
export class HealthModule {}
