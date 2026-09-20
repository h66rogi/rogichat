import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { requirePurgeCrashDatabase } from '../support/message-purge-crash-process.mjs';

export function isolated() { requirePurgeCrashDatabase(); }
export function distribution(values) {
  assert.ok(values.length > 0);
  const sorted = [...values].sort((a, b) => a - b);
  const percentile = p => Math.round(sorted[Math.ceil(p * sorted.length) - 1] * 100) / 100;
  return { count: values.length, p50Ms: percentile(0.5), p95Ms: percentile(0.95), p99Ms: percentile(0.99), maxMs: percentile(1) };
}
export async function evidence(name, measurements) {
  const report = { schemaVersion: 1, sourceSha: process.env.M12_SOURCE_SHA || 'local-unidentified',
    timestamp: new Date().toISOString(), node: process.version, ...measurements };
  console.log(`M12_EVIDENCE ${name} ${JSON.stringify(report)}`);
  if (process.env.M12_EVIDENCE_DIR) {
    await mkdir(process.env.M12_EVIDENCE_DIR, { recursive: true });
    await writeFile(join(process.env.M12_EVIDENCE_DIR, `${name}.json`), `${JSON.stringify(report, null, 2)}\n`);
  }
}
export async function batches(items, size, operation) {
  const output = [];
  for (let i = 0; i < items.length; i += size) output.push(...await Promise.all(items.slice(i, i + size).map(operation)));
  return output;
}
