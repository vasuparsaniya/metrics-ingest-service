import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  Logger,
} from '@nestjs/common';
import { Response } from 'express';

/** Maps expected database failures without exposing SQL or point payloads. */
@Catch()
export class ApiErrorFilter implements ExceptionFilter {
  private readonly logger = new Logger(ApiErrorFilter.name);

  catch(error: unknown, host: ArgumentsHost): void {
    const response = host.switchToHttp().getResponse<Response>();
    if (error instanceof HttpException) {
      const status = error.getStatus();
      if (status === 429) response.setHeader('Retry-After', '1');
      response.status(status).json(error.getResponse());
      return;
    }
    const code =
      typeof error === 'object' &&
      error !== null &&
      'code' in error &&
      typeof error.code === 'string'
        ? error.code
        : '';
    const parserStatus =
      typeof error === 'object' && error !== null && 'status' in error
        ? error.status
        : undefined;
    let status = 500;
    let message = 'Unexpected internal error';
    if (parserStatus === 413) {
      status = 413;
      message = 'Request body is too large';
    } else if (parserStatus === 400) {
      status = 400;
      message = 'Malformed JSON request body';
    } else if (['55P03', '57014', '40P01', '40001', '53300'].includes(code)) {
      status = 429;
      message = 'Database is busy; retry the request';
    } else if (
      code.startsWith('08') ||
      [
        'ECONNREFUSED',
        'ECONNRESET',
        'ETIMEDOUT',
        '57P01',
        '57P02',
        '57P03',
        '42P01',
      ].includes(code) ||
      (error instanceof Error &&
        /connection timeout|timeout exceeded when trying to connect/i.test(
          error.message,
        ))
    ) {
      status = 503;
      message = 'Database is unavailable or migrations are missing';
    } else if (['22003', '22008'].includes(code)) {
      status = 422;
      message = 'The result exceeds PostgreSQL numeric or timestamp bounds';
    }
    this.logger.error({
      event: 'request_failed',
      outcome: 'failed',
      status,
      code,
      errorType: error instanceof Error ? error.name : 'UnknownError',
    });
    if (status === 429) response.setHeader('Retry-After', '1');
    response.status(status).json({ statusCode: status, message });
  }
}
