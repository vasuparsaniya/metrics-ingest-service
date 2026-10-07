import { BadRequestException, Body, Controller, Post } from '@nestjs/common';
import { SeriesRepository } from './series.repository';
import { seriesName } from './series.validation';

/** Exposes series creation with boundary validation. */
@Controller('v1/series')
export class SeriesController {
  constructor(private readonly repository: SeriesRepository) {}

  @Post()
  create(@Body() body: unknown): Promise<{ seriesId: string }> {
    let name: string;
    try {
      name = seriesName(body);
    } catch (error: unknown) {
      throw new BadRequestException(
        error instanceof Error ? error.message : 'Invalid series name',
      );
    }
    return this.repository.create(name);
  }
}
