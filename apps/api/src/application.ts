import type { DeletionOptions } from './modules/deletion/deletion.module.js';
import type { Config } from './infrastructure/config/config.js';
import { configureOpenApi } from './infrastructure/openapi/openapi.js';
import type { AuthConfig } from './infrastructure/config/auth-config.js';
import 'reflect-metadata';
import { randomUUID } from 'node:crypto';
import type { DynamicModule } from '@nestjs/common';
import { SafeExceptionFilter } from './common/http/safe-exception.filter.js';
import { NestFactory } from '@nestjs/core';
import type { NestExpressApplication } from '@nestjs/platform-express';
import express from 'express';
import type { Express, Request, Response, NextFunction } from 'express';
import helmet from 'helmet';
import type { Server } from 'node:http';
import type { Database } from './infrastructure/database/database.js';
import { LifecycleState } from './common/lifecycle/lifecycle-state.js';
import type { SafeLogger } from './infrastructure/observability/logging.js';
import { authCors } from './common/http/auth-cors.js';
import type { AuthModuleOptions } from './modules/auth/auth.module.js';
import type { MediaOptions } from './modules/media/media.module.js';
import { AppModule } from './app.module.js';
import { WorkerModule } from './worker.module.js';

export async function createApi(database: Database, logger: SafeLogger, lifecycle = new LifecycleState(), auth?: AuthModuleOptions, media?: MediaOptions, environment: Config['environment'] = 'test', deletion?: DeletionOptions): Promise<NestExpressApplication> {
  return createConfiguredApi(AppModule.register(database, lifecycle, auth, media, undefined, deletion), logger, lifecycle, auth?.config, Boolean(media), environment);
}
export async function createConfiguredApi(module: DynamicModule, logger: SafeLogger, suppliedLifecycle?: LifecycleState, auth?: AuthConfig, media = false, environment: Config['environment'] = 'test'): Promise<NestExpressApplication> {
  const app = await NestFactory.create<NestExpressApplication>(module, { logger: false, abortOnError: false, bodyParser: false });
  const lifecycle = suppliedLifecycle ?? app.get<LifecycleState>(LifecycleState);
  const server: Express = app.getHttpAdapter().getInstance();
  server.disable('x-powered-by');
  server.disable('etag');
  // Hosted API is reachable only through one Caddy hop which overwrites X-Forwarded-For.
  // Do not enable on direct local/test listeners or expand to arbitrary proxy chains.
  server.set('trust proxy', auth?.secure ? 1 : false);
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
  if (auth) authCors(server, auth);
  const json = express.json({ limit: '64kb', strict: true, inflate: false });
  server.use((request: Request, response: Response, next: NextFunction) => {
    if (request.method === 'POST' && /^\/v1\/media\/upload-intents\/[^/]+\/content$/.test(request.path)) { next(); return; }
    json(request, response, next);
  });
  // Documentation routes never change product authentication or controller validation.
  configureOpenApi(app, environment, auth);
  app.useGlobalFilters(new SafeExceptionFilter());
  const http: Server = app.getHttpServer();
  http.requestTimeout = media ? 310000 : 15000;
  http.headersTimeout = 10000;
  http.keepAliveTimeout = 5000;
  http.maxRequestsPerSocket = 1000;
  http.maxConnections = 1000;
  return app;
}

export function createWorker(database: Database, lifecycle = new LifecycleState()) {
  return NestFactory.createApplicationContext(WorkerModule.register(database, lifecycle), { logger: false, abortOnError: false });
}
