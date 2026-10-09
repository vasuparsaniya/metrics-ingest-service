import { Module } from '@nestjs/common';
import { StatsController } from './stats.controller';
import { StatsRepository } from './stats.repository';

/** Registers row counts and per-series coverage. */
@Module({ controllers: [StatsController], providers: [StatsRepository] })
export class StatsModule {}
