import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createECDH, randomBytes, randomUUID } from 'node:crypto';
import { createConfiguredApi } from '../../dist/application.js';
import { AppModule } from '../../dist/app.module.js';
import { LifecycleState } from '../../dist/common/lifecycle/lifecycle-state.js';
import { SafeLogger } from '../../dist/infrastructure/observability/logging.js';
import { readConfig } from '../../dist/infrastructure/config/config.js';
import { MysqlDatabase } from '../../dist/infrastructure/database/database.js';
import { SessionService } from '../../dist/modules/auth/session.service.js';
import { SessionRepository } from '../../dist/modules/auth/session.repository.js';
import { readPushConfig } from '../../dist/modules/notifications/push-config.js';
import { createUser } from '../support/domain-fixture.mjs';
import { responseContract } from '../support/openapi-response.mjs';

for (const configured of [false, true]) test(`capability HTTP uses current proof and minimal DTO (configured=${configured})`, { timeout: 25000 }, async t => {
  assert.equal(process.env.ROGICHAT_TEST_MYSQL, 'disposable');
  const db = new MysqlDatabase(readConfig('api'));
  const config = { audience: 'rogi-test', origin: 'http://localhost:3001', callback: 'http://127.0.0.1:3000/v1/auth/soop/callback', secure: false, key: randomBytes(32), broker: undefined };
  const sessions = new SessionService(new SessionRepository(), config.audience, config.key);
  const fixture = await db.transactions.write(async tx => {
    const user = await createUser(tx, '알림 설정 사용자');
    await tx.prisma.users.update({ where: { id: user }, data: { terms_version: '2026-09-20' } });
    await tx.prisma.platform_soop.create({ data: { id: randomUUID(), user_id: user, provider_subject: randomBytes(24), verified_at: await tx.now() } });
    return { user, web: await sessions.issue(tx, user), native: await sessions.issueNative(tx, user, 'ios') };
  });
  const key = createECDH('prime256v1'); key.generateKeys();
  const push = readPushConfig({ APP_ENV: 'test', ...(configured ? { PUSH_TEST_VAPID_PUBLIC_KEY: key.getPublicKey().toString('base64url'), PUSH_TEST_VAPID_PRIVATE_KEY: key.getPrivateKey().toString('base64url'), PUSH_TEST_VAPID_SUBJECT: 'mailto:push@example.com' } : {}) });
  const lifecycle = new LifecycleState();
  const app = await createConfiguredApi(AppModule.register(db, lifecycle, { config }, undefined, push), new SafeLogger('api', () => {}), lifecycle, config);
  t.after(async () => { await app.close(); await db.close(); });
  await app.listen(0, '127.0.0.1');
  const base = await app.getUrl(); const path = '/v1/me/push-capabilities';
  const verify = responseContract(app, config);
  const web = { cookie: `rogi_session=${fixture.web.token}` };
  const native = { authorization: `Bearer ${fixture.native.token}`, 'x-rogi-client': 'ios' };
  async function request(headers, status, body) {
    const response = await fetch(base + path, { headers });
    const value = await response.json();
    assert.equal(response.status, status); assert.equal(response.headers.get('cache-control'), 'no-store');
    verify('GET', path, response.status, value); assert.deepEqual(value, body);
  }
  const error = code => ({ error: { code } });
  await request({}, 401, error('UNAUTHENTICATED'));
  await request({ ...web, ...native }, 400, error('INVALID_REQUEST'));
  await request({ authorization: native.authorization }, 400, error('INVALID_REQUEST'));
  await request({ ...native, 'x-rogi-client': 'android' }, 401, error('UNAUTHENTICATED'));
  await request(web, 200, configured ? { available: true, applicationServerKey: push.vapid.publicKey } : { available: false });
  await request(native, 200, { available: false });
  for (const terms_version of [null, '2020-01-01']) {
    await db.transactions.write(tx => tx.prisma.users.update({ where: { id: fixture.user }, data: { terms_version } }));
    await request(web, 403, error('TERMS_REQUIRED')); await request(native, 403, error('TERMS_REQUIRED'));
  }
  await db.transactions.write(tx => tx.prisma.users.update({ where: { id: fixture.user }, data: { terms_version: '2026-09-20' } }));
  await db.transactions.write(tx => tx.prisma.platform_soop.updateMany({ where: { user_id: fixture.user }, data: { status: 'REVOKED' } }));
  await request(web, 403, error('SOOP_LINK_REQUIRED')); await request(native, 403, error('SOOP_LINK_REQUIRED'));
  await db.transactions.write(tx => tx.prisma.platform_soop.updateMany({ where: { user_id: fixture.user }, data: { status: 'VERIFIED' } }));
  await db.transactions.write(tx => tx.prisma.users.update({ where: { id: fixture.user }, data: { status: 'SUSPENDED' } }));
  await request(web, 401, error('UNAUTHENTICATED'));
  await db.transactions.write(tx => tx.prisma.users.update({ where: { id: fixture.user }, data: { status: 'ACTIVE' } }));
  await db.transactions.write(async tx => {
    const principal = await sessions.require(tx, fixture.web.token);
    await new SessionRepository().revoke(tx, principal.sessionId);
  });
  await request(web, 401, error('UNAUTHENTICATED'));
});
