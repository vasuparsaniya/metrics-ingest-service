import { Controller, Get } from '@nestjs/common';
import { StatsRepository, StatsResponse } from './stats.repository';

/** Exposes exact totals and per-series coverage. */
@Controller('v1/stats')
export class StatsController {
  constructor(private readonly repository: StatsRepository) {}

  @Get()
  stats(): Promise<StatsResponse> {
    return this.repository.stats();
  }
}
