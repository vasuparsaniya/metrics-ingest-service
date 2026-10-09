import { Controller, Get, Param, Query, Res } from '@nestjs/common';
import { Response } from 'express';
import { BucketResponse, QueriesRepository } from './queries.repository';
import { bucketQuery, queryId } from './query.validation';

/** Exposes current bucket summaries and latest-by-measurement-time reads. */
@Controller('v1/series/:id')
export class QueriesController {
  constructor(private readonly repository: QueriesRepository) {}

  @Get('latest')
  async latest(
    @Param('id') id: string,
    @Res() response: Response,
  ): Promise<void> {
    // Nest treats a returned null as an empty body; send literal JSON null explicitly.
    response.json(await this.repository.latest(queryId(id)));
  }

  @Get('points')
  points(
    @Param('id') id: string,
    @Query('from') from: unknown,
    @Query('to') to: unknown,
    @Query('bucket') bucket: unknown,
  ): Promise<BucketResponse[]> {
    return this.repository.buckets(bucketQuery(id, from, to, bucket));
  }
}
