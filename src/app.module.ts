import { DynamicModule, Global, Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { BearerTokenGuard } from './auth/bearer-token.guard';
import { Environment } from './config/environment';
import { DatabaseModule } from './database/database.module';
import { HealthModule } from './health/health.module';

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
      ],
      providers: [{ provide: APP_GUARD, useClass: BearerTokenGuard }],
    };
  }
}
