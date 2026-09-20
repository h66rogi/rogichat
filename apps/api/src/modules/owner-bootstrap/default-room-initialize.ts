// Official migration initialization entrypoint; no owner configuration or fake
// account is consumed here. Runtime owner binding stays in the API module.
import 'reflect-metadata';
import { pathToFileURL } from 'node:url';
import { NestFactory } from '@nestjs/core';
import { readConfig } from '../../infrastructure/config/config.js';
import { PrismaDatabase } from '../../infrastructure/database/database.js';
import type { Database } from '../../infrastructure/database/database.js';
import { DatabaseModule } from '../../infrastructure/database/database.module.js';
import { DefaultRoomModule } from './default-room.module.js';

export async function initializeDefaultRoom(database: Database): Promise<void> {
  const app = await NestFactory.createApplicationContext(DefaultRoomModule.register(
    DatabaseModule.register({ database, externallyOwned: true }), {}, {}), { logger: false, abortOnError: false });
  await app.close();
}
async function main() {
  const database = new PrismaDatabase(readConfig('worker'));
  try { await initializeDefaultRoom(database); process.stdout.write('default_room_initialized\n'); }
  finally { await database.close(); }
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  void main().catch(() => { process.stderr.write('default_room_initialization_failed\n'); process.exitCode = 1; });
}
