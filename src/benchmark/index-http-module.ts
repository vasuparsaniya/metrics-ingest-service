import { DynamicModule, Global, Module } from '@nestjs/common';
import { APP_FILTER, APP_GUARD, APP_INTERCEPTOR } from '@nestjs/core';
import { BearerTokenGuard } from '../auth/bearer-token.guard';
import { Environment } from '../config/environment';
import { DatabaseModule } from '../database/database.module';
import { HealthModule } from '../health/health.module';
import { ApiErrorFilter } from '../http/api-error.filter';
import { RequestLogInterceptor } from '../http/request-log.interceptor';
import { SeriesModule } from '../series/series.module';
import { QueriesModule } from '../queries/queries.module';
import { IngestController } from '../ingest/ingest.controller';
import { IngestService } from '../ingest/ingest.service';
import { IngestRepository } from '../ingest/ingest.repository';
import { StatsController } from '../stats/stats.controller';
import { StatsRepository } from '../stats/stats.repository';
import { IndexHttpRepository } from './index-http-repository';
import { IndexHttpStatsRepository } from './index-http-stats';

@Global()
@Module({})
class IndexHttpEnvironmentModule {
  static register(environment: Environment): DynamicModule {
    return {
      module: IndexHttpEnvironmentModule,
      providers: [{ provide: 'ENVIRONMENT', useValue: environment }],
      exports: ['ENVIRONMENT'],
    };
  }
}

/** Isolated benchmark composition retaining the ordinary HTTP service pipeline. */
@Module({})
export class IndexHttpModule {
  /** Registers benchmark repositories without modifying normal application modules. */
  static register(environment: Environment): DynamicModule {
    return {
      module: IndexHttpModule,
      imports: [
        IndexHttpEnvironmentModule.register(environment),
        DatabaseModule,
        HealthModule,
        SeriesModule,
        QueriesModule,
      ],
      controllers: [IngestController, StatsController],
      providers: [
        IngestService,
        { provide: IngestRepository, useClass: IndexHttpRepository },
        { provide: StatsRepository, useClass: IndexHttpStatsRepository },
        { provide: APP_GUARD, useClass: BearerTokenGuard },
        { provide: APP_FILTER, useClass: ApiErrorFilter },
        { provide: APP_INTERCEPTOR, useClass: RequestLogInterceptor },
      ],
    };
  }
}
