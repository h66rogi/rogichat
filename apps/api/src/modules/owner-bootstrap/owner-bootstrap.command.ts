// Operator-only composition. Never imported by API/worker or an HTTP controller.
import 'reflect-metadata';
import { pathToFileURL } from 'node:url';
import { NestFactory } from '@nestjs/core';
import { readConfig } from '../../infrastructure/config/config.js';
import { readAuthConfig } from '../../infrastructure/config/auth-config.js';
import { DatabaseModule } from '../../infrastructure/database/database.module.js';
import { OwnerBootstrapModule } from './owner-bootstrap.module.js';
import { OwnerBootstrapService } from './owner-bootstrap.service.js';
import { readOwnerBootstrapRequest, requirePrivateFile } from './owner-bootstrap.request.js';

export async function main() {
  if (process.argv.length !== 2) throw new Error('owner_bootstrap_arguments');
  const request = readOwnerBootstrapRequest();
  requirePrivateFile(process.env.DATABASE_SECRET_FILE);
  requirePrivateFile(process.env.AUTH_SECRET_FILE);
  const config = readConfig('worker'), auth = readAuthConfig(config);
  if (request.environment !== config.environment || !auth.identityGuardKey) throw new Error('owner_bootstrap_configuration');
  const app = await NestFactory.createApplicationContext(OwnerBootstrapModule.register(DatabaseModule.register({ config }),
    { environment: config.environment, identityGuardKey: auth.identityGuardKey }), { logger: false, abortOnError: false });
  try {
    const result = await app.get(OwnerBootstrapService).provision(request);
    // Account, provider subject, room name, request document and stack are never logged.
    process.stdout.write(`${JSON.stringify(result)}\n`);
  } finally { await app.close(); }
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  void main().catch(() => {
    // Includes unknown COMMIT: no success claim and no unsafe internal replay.
    process.stderr.write('owner_bootstrap_failed_or_outcome_unknown; rerun_exact_request\n');
    process.exitCode = 1;
  });
}
