import { DynamicModule, Global, Module } from '@nestjs/common';
import { APP_FILTER, APP_GUARD, APP_INTERCEPTOR } from '@nestjs/core';
import { BearerTokenGuard } from './auth/bearer-token.guard';
import { Environment } from './config/environment';
import { DatabaseModule } from './database/database.module';
import { HealthModule } from './health/health.module';
import { ApiErrorFilter } from './http/api-error.filter';
import { RequestLogInterceptor } from './http/request-log.interceptor';
import { SeriesModule } from './series/series.module';
import { IngestModule } from './ingest/ingest.module';
import { QueriesModule } from './queries/queries.module';
import { StatsModule } from './stats/stats.module';

@Global()
@Module({})
class EnvironmentModule {
  static register(environment: Environment): DynamicModule {
    return {
      module: EnvironmentModule,
      providers: [{ provide: 'ENVIRONMENT', useValue: environment }],
      exports: ['ENVIRONMENT'],
    };
  }
}

/** Wires validated configuration and the initial application features. */
@Module({})
export class AppModule {
  static register(environment: Environment): DynamicModule {
    return {
      module: AppModule,
      imports: [
        EnvironmentModule.register(environment),
        DatabaseModule,
        HealthModule,
        SeriesModule,
        IngestModule,
        QueriesModule,
        StatsModule,
      ],
      providers: [
        { provide: APP_GUARD, useClass: BearerTokenGuard },
        { provide: APP_FILTER, useClass: ApiErrorFilter },
        { provide: APP_INTERCEPTOR, useClass: RequestLogInterceptor },
      ],
    };
  }
}
