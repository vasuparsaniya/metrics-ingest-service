import { Module } from '@nestjs/common';
import { QueriesController } from './queries.controller';
import { QueriesRepository } from './queries.repository';

/** Registers bucket and latest-point queries. */
@Module({ controllers: [QueriesController], providers: [QueriesRepository] })
export class QueriesModule {}
