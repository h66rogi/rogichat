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
for (const route of ['/preview', '/preview/chat/fan', '/preview/chat/streamer', '/preview/settings', '/demo', '/mock', '/fixtures', '/v1/auth/session', '/.next/prerender-manifest.json', '/_next/server/server-reference-manifest.json', '/_next/cache/rogichat-runtime/prerender-manifest.json', '/prerender-manifest.template.json']) {
  assert.equal((await get(route)).status, 404, `Forbidden route or API proxy: ${route}`);
}
const legacy = await get('/auth/login?error=access_denied&code=SHOULD-NOT-PROPAGATE&state=ignored', {
  headers: { Host: 'untrusted.invalid', 'X-Forwarded-Host': 'untrusted.invalid', 'X-Forwarded-Proto': 'http' },
});
assert.equal(legacy.status, 303);
const location = legacy.headers.get('location');
const webOrigin = environment === 'qa' ? 'https://qa.rogi.chat' : 'https://rogi.chat';
assert(['/login?reason=cancelled', `${webOrigin}/login?reason=cancelled`].includes(location), 'Legacy callback must use a relative or exact configured web origin and enumerated reason only');
const callback = await get('/mobile/auth/complete?code=SHOULD-NOT-PROPAGATE&state=ignored');
assert.equal(callback.status, 200);
assert.equal(callback.headers.get('referrer-policy'), 'no-referrer');
assert.match(callback.headers.get('cache-control') ?? '', /no-store/);
assert.match(callback.headers.get('content-security-policy') ?? '', /default-src 'none'/);
assert(!(await callback.text()).includes('SHOULD-NOT-PROPAGATE'), 'Native fallback must not reflect callback code');
const appleResponse = await get('/.well-known/apple-app-site-association');
const androidResponse = await get('/.well-known/assetlinks.json');
for (const response of [appleResponse, androidResponse]) {
  assert.equal(response.status, 200);
  assert.match(response.headers.get('content-type') ?? '', /application\/json/);
}
const apple = await appleResponse.json();
const android = await androidResponse.json();
assert.equal(apple.applinks.details.length, environment === 'qa' ? 1 : 0);
assert.equal(apple.webcredentials.apps.length, environment === 'qa' ? 1 : 0);
assert.equal(android.length, environment === 'qa' ? 1 : 0);
if (environment === 'qa') {
  assert.equal(apple.applinks.details[0].components[0]['/'], '/mobile/auth/complete');
  assert.equal(android[0].target.namespace, 'android_app');
  assert(apple.applinks.details[0].appIDs[0].endsWith(`.${android[0].target.package_name}`));
}
for (const route of ['/sw.js', '/manifest.webmanifest']) assert.equal((await get(route)).status, 200, route);
console.log(`Runtime ${environment}: health, rendered origin, host isolation and absent preview routes passed`);
