// One-shot operator entry, compiled into the same immutable runtime artifact.
// Never imported by API/worker composition; no job loops or HTTP endpoint.
import 'reflect-metadata';
import { pathToFileURL } from 'node:url';
import { NestFactory } from '@nestjs/core';
import { readConfig } from '../../infrastructure/config/config.js';
import { DatabaseModule } from '../../infrastructure/database/database.module.js';
import { DeletionBacklogModule } from './deletion-backlog.module.js';
import { DeletionBacklogService } from './deletion-backlog.service.js';

export async function main() {
  if (process.argv.length !== 2) throw new Error('deletion_backlog_arguments');
  const app = await NestFactory.createApplicationContext(DeletionBacklogModule.register(
    DatabaseModule.register({ config: readConfig('worker') })), { logger: false, abortOnError: false });
  try {
    const report = await app.get(DeletionBacklogService).inspect();
    process.stdout.write(`${JSON.stringify(report)}\n`);
    process.exitCode = report.requiresAttention ? 2 : 0;
  } finally { await app.close(); }
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  void main().catch(() => {
    process.stderr.write('deletion_backlog_unavailable\n');
    process.exitCode = 1;
  });
}
