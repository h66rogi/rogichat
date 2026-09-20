#!/usr/bin/env node
import assert from 'node:assert/strict';
const [base, environment] = process.argv.slice(2);
assert(['qa', 'production'].includes(environment));
const origin = environment === 'qa' ? 'https://api.qa.rogi.chat' : 'https://api.rogi.chat';
const get = (route, extra = {}) => fetch(`${base}${route}`, { redirect: 'manual', signal: AbortSignal.timeout(5000), ...extra });
let ready = false;
for (let attempt = 0; attempt < 60; attempt++) {
  try { if ((await get('/healthz')).status === 200) { ready = true; break; } } catch { /* booting */ }
  await new Promise(resolve => setTimeout(resolve, 500));
}
assert(ready, 'Unauthenticated health did not become ready');
const health = await get('/healthz');
assert((await health.text()).length < 100, 'Health must be minimal');
const home = await get('/');
assert.equal(home.status, 200);
const body = await home.text();
assert(body.includes(origin), `Server-rendered runtime API origin missing: ${origin}`);
assert(!body.includes('rogichat-preview-fixture-7f415df1'));
const spoofed = await get('/', { headers: { Host: 'untrusted.invalid', 'X-Forwarded-Host': 'untrusted.invalid', 'X-Forwarded-Proto': 'http' } });
assert.equal(spoofed.status, 200);
const spoofedBody = await spoofed.text();
assert(spoofedBody.includes(origin));
assert(!spoofedBody.includes('untrusted.invalid'), 'Untrusted request host reached rendered config');
for (const route of ['/preview', '/preview/chat/fan', '/preview/chat/streamer', '/preview/settings', '/demo', '/mock', '/fixtures', '/v1/auth/me']) {
  assert.equal((await get(route)).status, 404, `Forbidden route or API proxy: ${route}`);
}
for (const route of ['/sw.js', '/manifest.webmanifest']) assert.equal((await get(route)).status, 200, route);
console.log(`Runtime ${environment}: health, rendered origin, host isolation and absent preview routes passed`);
