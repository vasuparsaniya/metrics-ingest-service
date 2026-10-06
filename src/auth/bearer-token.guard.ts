import { timingSafeEqual } from 'node:crypto';
import {
  CanActivate,
  ExecutionContext,
  Inject,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { Request } from 'express';
import { Environment } from '../config/environment';

/** Enforces the assignment's single static bearer token on HTTP endpoints. */
@Injectable()
export class BearerTokenGuard implements CanActivate {
  private readonly expected: Buffer;

  constructor(@Inject('ENVIRONMENT') environment: Environment) {
    this.expected = Buffer.from(`Bearer ${environment.apiToken}`);
  }

  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest<Request>();
    const supplied = Buffer.from(request.headers.authorization ?? '');
    if (
      supplied.length !== this.expected.length ||
      !timingSafeEqual(supplied, this.expected)
    ) {
      throw new UnauthorizedException('A valid bearer token is required');
    }
    return true;
  }
}
