import { Module } from '@nestjs/common';
import { IngestController } from './ingest.controller';
import { IngestRepository } from './ingest.repository';
import { IngestService } from './ingest.service';

/** Registers batch ingestion, request replay, and admission control. */
@Module({
  controllers: [IngestController],
  providers: [IngestService, IngestRepository],
})
export class IngestModule {}
