import { Body, Controller, HttpCode, Post, Req } from '@nestjs/common';
import { Request } from 'express';
import { IngestService } from './ingest.service';
import { IngestResponse } from './ingest.types';
import { requestKey } from './ingest.validation';

/** Accepts bounded batches and an explicit retry identifier. */
@Controller('v1/ingest')
export class IngestController {
  constructor(private readonly service: IngestService) {}

  @Post()
  @HttpCode(200)
  ingest(
    @Req() request: Request,
    @Body() body: unknown,
  ): Promise<IngestResponse> {
    return this.service.ingest(requestKey(request.rawHeaders), body);
  }
}
