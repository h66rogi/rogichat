import 'reflect-metadata';
import { Module } from '@nestjs/common';
import { MediaWriteProofModule } from '../../dist/modules/media/media-write-proof.module.js';
import { MediaWriteProofService } from '../../dist/modules/media/media-write-proof.service.js';
import { NestFactory } from '@nestjs/core';
import { MessagesCoreModule } from '../../dist/modules/messages/messages-core.module.js';
import { MessagesCoreService } from '../../dist/modules/messages/messages-core.service.js';
import { AccessService } from '../../dist/modules/access/access.service.js';
import { JobsRepository } from '../../dist/modules/jobs/jobs.repository.js';
import { JobsCoreService } from '../../dist/modules/jobs/jobs-core.service.js';
import { Jobs } from '../../dist/modules/jobs/jobs.service.js';
import { WorkerLoop } from '../../dist/modules/jobs/worker-loop.js';
import { MediaWorkerService } from '../../dist/modules/media/media-worker.service.js';
import { MediaWorkerRepository } from '../../dist/modules/media/media-worker.repository.js';
import { UnixImageDecoder } from '../../dist/modules/media/adapters/media-decoder-client.js';
import { MediaSpooler } from '../../dist/common/media/media-spool.js';
import { MysqlDatabase } from '../../dist/infrastructure/database/database.js';
import { readConfig } from '../../dist/infrastructure/config/config.js';
import { isolated } from '../quality/evidence.mjs';
import { DiskStore } from './disk-store.mjs';
isolated();
const [directory, socket, objects] = process.argv.slice(2);
const db = new MysqlDatabase(readConfig('worker'));
class SoakWorkerModule {}
Module({ imports: [MessagesCoreModule, MediaWriteProofModule] })(SoakWorkerModule);
const context = await NestFactory.createApplicationContext(SoakWorkerModule, { logger: false, abortOnError: false });
const repository = new JobsRepository(), core = new JobsCoreService(repository);
const jobs = new Jobs(db.transactions, 'worker', repository, core);
const client = new UnixImageDecoder(socket, new MediaSpooler({ directory, maxConcurrent: 1, capacityBytes: 64 * 1024 * 1024 }));
const decoder = { decodeVideo(...args) { process.send({ type: 'decode-start' }); return client.decodeVideo(...args); } };
const service = new MediaWorkerService(db.transactions, new DiskStore(objects), decoder, 'test', new MediaWorkerRepository(), core, context.get(AccessService), context.get(MessagesCoreService), context.get(MediaWriteProofService));
const lifecycle = { draining: false };
const loop = new WorkerLoop(jobs, lifecycle, { MEDIA: async lease => {
  process.send({ type: 'start', assetId: lease.resourceId, generation: String(lease.generation) });
  try { const result = await service.processMedia(lease); process.send({ type: 'complete', assetId: lease.resourceId, result }); return result; }
  catch (error) { process.send({ type: 'job-error', code: error.code ?? 'unclassified' }); throw error; }
} }, { ready: async () => (await db.check()).ready, leaseMs: 300000 });
// Production entry owns its lifecycle; this isolated child owns an IPC lifetime.
process.channel.ref();
loop.start(); process.send({ type: 'ready' });
process.once('SIGTERM', async () => { lifecycle.draining = true; await loop.stop(); await context.close(); await db.close(); process.exit(0); });
