#!/usr/bin/env node
import assert from 'node:assert/strict';
const base = process.argv[2];
for (let attempt = 0; attempt < 60; attempt++) {
  let response;
  try { response = await fetch(`${base}/healthz`, { signal: AbortSignal.timeout(2000) }); } catch { /* booting */ }
  if (response) {
    assert.equal(response.status, 500, 'Misconfigured runtime must not report healthy');
    console.log('Invalid runtime configuration fails health closed');
    process.exit(0);
  }
  await new Promise(resolve => setTimeout(resolve, 500));
}
throw new Error('Invalid-runtime probe never reached the application');
