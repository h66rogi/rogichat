// Private operator-only entrypoint. Not imported by HTTP or worker composition.
import 'reflect-metadata';
import { pathToFileURL } from 'node:url';
import { Module } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { DatabaseModule } from '../../infrastructure/database/database.module.js';
import { DATABASE } from '../../infrastructure/database/database.tokens.js';
import type { Database } from '../../infrastructure/database/database.js';
import { Transactions } from '../../infrastructure/database/transactions.js';
import { readConfig } from '../../infrastructure/config/config.js';
import { readAuthConfig } from '../../infrastructure/config/auth-config.js';
import { PasswordHasher } from '../auth/password/password-hasher.js';
import { readAdminBootstrapRequest } from './admin-bootstrap.request.js';
import { AdminBootstrapRepository } from './admin-bootstrap.repository.js';
import { AdminBootstrapService } from './admin-bootstrap.service.js';
@Module({})
class AdminBootstrapModule {}
export async function main() {
  if (process.argv.length !== 2) throw new Error('admin_bootstrap_arguments');
  const request = readAdminBootstrapRequest();
  const config = readConfig('worker'), auth = readAuthConfig(config);
  const app = await NestFactory.createApplicationContext({ module: AdminBootstrapModule, imports: [DatabaseModule.register({ config })],
    providers: [AdminBootstrapRepository, PasswordHasher, { provide: AdminBootstrapService, inject: [Transactions, AdminBootstrapRepository, PasswordHasher],
      useFactory: (tx: Transactions, repository: AdminBootstrapRepository, hasher: PasswordHasher) => new AdminBootstrapService(tx, repository, hasher, config.environment, auth.key) }] }, { logger: false, abortOnError: false });
  try {
    if (!(await app.get<Database>(DATABASE).check()).ready) throw new Error('admin_bootstrap_unavailable');
    await app.get(AdminBootstrapService).apply(request); process.stdout.write('admin_bootstrap_applied\n');
  }
  finally { await app.close(); }
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) void main().catch(() => { process.stderr.write('admin_bootstrap_failed_or_outcome_unknown\n'); process.exitCode = 1; });
