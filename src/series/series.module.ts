import { Module } from '@nestjs/common';
import { SeriesController } from './series.controller';
import { SeriesRepository } from './series.repository';

/** Registers the series creation feature. */
@Module({ controllers: [SeriesController], providers: [SeriesRepository] })
export class SeriesModule {}
