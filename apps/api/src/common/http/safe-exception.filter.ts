import { Catch, HttpException } from '@nestjs/common';
import type { ArgumentsHost, ExceptionFilter } from '@nestjs/common';
import type { Response } from 'express';
import { ApiError } from '../../modules/auth/auth-primitives.js';
import { DatabaseUnavailableError } from '../../infrastructure/database/database-unavailable.js';
import type { SafeLogger } from '../../infrastructure/observability/logging.js';
@Catch()
export class SafeExceptionFilter implements ExceptionFilter {
  constructor(private readonly logger?: SafeLogger) {}
  catch(error: unknown, host: ArgumentsHost): void {
    const response = host.switchToHttp().getResponse<Response>();
    const status = error instanceof DatabaseUnavailableError ? 503 : error instanceof HttpException ? error.getStatus() :
      (error && typeof error === 'object' && 'type' in error && error.type === 'entity.too.large' ? 413 :
        (error instanceof SyntaxError ? 400 : 500));
    const code = error instanceof ApiError ? error.code : status === 503 ? 'UNAVAILABLE' : status === 404 ? 'NOT_FOUND' :
      status === 413 ? 'PAYLOAD_TOO_LARGE' : status < 500 ? 'BAD_REQUEST' : 'INTERNAL_ERROR';
    if (status >= 500) this.logger?.event('request_failed', { status, reason: error instanceof DatabaseUnavailableError ? error.reason : 'runtime' });
    if (error instanceof DatabaseUnavailableError) response.setHeader('Retry-After', '1');
    response.status(status).json({ error: { code } });
  }
}
