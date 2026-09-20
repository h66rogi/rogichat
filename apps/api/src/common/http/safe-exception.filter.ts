import { Catch, HttpException } from '@nestjs/common';
import type { ArgumentsHost, ExceptionFilter } from '@nestjs/common';
import type { Response } from 'express';
import { ApiError } from '../../modules/auth/auth-primitives.js';
@Catch()
export class SafeExceptionFilter implements ExceptionFilter {
  catch(error: unknown, host: ArgumentsHost): void {
    const response = host.switchToHttp().getResponse<Response>();
    const status = error instanceof HttpException ? error.getStatus() :
      (error && typeof error === 'object' && 'type' in error && error.type === 'entity.too.large' ? 413 :
        (error instanceof SyntaxError ? 400 : 500));
    const code = error instanceof ApiError ? error.code : status === 503 ? 'UNAVAILABLE' : status === 404 ? 'NOT_FOUND' :
      status === 413 ? 'PAYLOAD_TOO_LARGE' : status < 500 ? 'BAD_REQUEST' : 'INTERNAL_ERROR';
    response.status(status).json({ error: { code } });
  }
}
