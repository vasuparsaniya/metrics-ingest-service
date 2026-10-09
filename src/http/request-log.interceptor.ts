import {
  CallHandler,
  ExecutionContext,
  Injectable,
  Logger,
  NestInterceptor,
} from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { Request, Response } from 'express';
import { Observable, tap } from 'rxjs';

/** Logs request outcomes and timing without row bodies or authorization headers. */
@Injectable()
export class RequestLogInterceptor implements NestInterceptor {
  private readonly logger = new Logger(RequestLogInterceptor.name);

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const request = context.switchToHttp().getRequest<Request>();
    const response = context.switchToHttp().getResponse<Response>();
    const requestId = randomUUID();
    const start = performance.now();
    response.setHeader('X-Request-Id', requestId);
    return next.handle().pipe(
      tap({
        next: () =>
          this.logger.log({
            event: 'http_request',
            requestId,
            method: request.method,
            route: request.route ? request.path : 'unknown',
            durationMs: performance.now() - start,
            outcome: 'success',
          }),
        error: () =>
          this.logger.warn({
            event: 'http_request',
            requestId,
            method: request.method,
            path: request.path,
            durationMs: performance.now() - start,
            outcome: 'failed',
          }),
      }),
    );
  }
}
