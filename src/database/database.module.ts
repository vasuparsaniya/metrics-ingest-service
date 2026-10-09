import { Global, Module } from '@nestjs/common';
import { DatabaseService } from './database.service';

/** Shares a single connection pool across feature modules. */
@Global()
@Module({ providers: [DatabaseService], exports: [DatabaseService] })
export class DatabaseModule {}
