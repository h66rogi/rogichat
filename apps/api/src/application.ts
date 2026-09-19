import 'reflect-metadata';
import { randomUUID } from 'node:crypto';
import { Catch, HttpException, Module } from '@nestjs/common';
import type { ArgumentsHost, DynamicModule, ExceptionFilter } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import type { NestExpressApplication } from '@nestjs/platform-express';
import express from 'express';
import type { Express, Request, Response, NextFunction } from 'express';
import helmet from 'helmet';
import type { Server } from 'node:http';
import type { Database } from './database.js';
import { DATABASE, HealthController, LifecycleState } from './health.js';
import type { SafeLogger } from './logging.js';
import { ApiError } from './auth-core.js';
import { AUTH, AuthController, authCors } from './auth-http.js';
import type { AuthRuntime } from './auth-http.js';
import { CommunityController } from './community-http.js';
import { MessagesController } from './messages-http.js';

@Module({})
class RuntimeModule {
  static register(database: Database, lifecycle: LifecycleState, http: boolean, auth?: AuthRuntime): DynamicModule {
    return {
      module: RuntimeModule,
      controllers: http ? [HealthController, ...(auth ? [AuthController, CommunityController, MessagesController] : [])] : [],
      providers: [{ provide: DATABASE, useValue: database }, { provide: LifecycleState, useValue: lifecycle }, ...(auth ? [{ provide: AUTH, useValue: auth }] : [])],
    };
  }
}

@Catch()
class SafeExceptionFilter implements ExceptionFilter {
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

export async function createApi(database: Database, logger: SafeLogger, lifecycle = new LifecycleState(), auth?: AuthRuntime): Promise<NestExpressApplication> {
  const app = await NestFactory.create<NestExpressApplication>(RuntimeModule.register(database, lifecycle, true, auth), {
    logger: false, abortOnError: false, bodyParser: false,
  });
  const server: Express = app.getHttpAdapter().getInstance();
  server.disable('x-powered-by');
  server.disable('etag');
  // Hosted API is reachable only through one Caddy hop which overwrites X-Forwarded-For.
  // Do not enable on direct local/test listeners or expand to arbitrary proxy chains.
  server.set('trust proxy', auth?.config.secure ? 1 : false);
  server.use(helmet({ strictTransportSecurity: false }));
  server.use((request: Request, response: Response, next: NextFunction) => {
    const started = performance.now();
    const requestId = randomUUID();
    const route = request.path === '/live' ? 'live' : request.path === '/ready' ? 'ready' : 'unmatched';
    response.setHeader('Cache-Control', 'no-store');
    response.setHeader('X-Request-Id', requestId);
    response.once('finish', () => { logger.event('request', { route, requestId, status: response.statusCode, durationMs: performance.now() - started }); });
    if (lifecycle.draining && request.path !== '/live') { response.status(503).json({ error: { code: 'UNAVAILABLE' } }); return; }
    next();
  });
  if (auth) authCors(server, auth.config);
  server.use(express.json({ limit: '64kb', strict: true, inflate: false }));
  // No static serving, Swagger UI, debug or test-auth routes.
  app.useGlobalFilters(new SafeExceptionFilter());
  const http: Server = app.getHttpServer();
  http.requestTimeout = 15000;
  http.headersTimeout = 10000;
  http.keepAliveTimeout = 5000;
  http.maxRequestsPerSocket = 1000;
  http.maxConnections = 1000;
  return app;
}

export function createWorker(database: Database, lifecycle = new LifecycleState()) {
  return NestFactory.createApplicationContext(RuntimeModule.register(database, lifecycle, false), { logger: false, abortOnError: false });
}
