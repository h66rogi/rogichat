import assert from 'node:assert/strict';
import test from 'node:test';
import { appleAssociation, androidAssociation, MOBILE_CALLBACK_PATH } from './mobile-association';
import { mobileFallbackResponse } from './mobile-fallback';
void test('QA Apple association authorizes only the verified app and exact callback path', () => {
  const apple = appleAssociation('qa');
  assert.deepEqual(apple.webcredentials.apps, ['FS9YQ9URFY.chat.rogi.rogichat.qa']);
  assert.deepEqual(apple.applinks.details, [{ appIDs: apple.webcredentials.apps, components: [{ '/': MOBILE_CALLBACK_PATH }] }]);
});
void test('QA Android association carries the verified public signing fingerprint and scoped path rules', () => {
  const android = androidAssociation('qa');
  assert.equal(android.length, 1);
  assert.equal(android[0]?.target.package_name, 'chat.rogi.rogichat.qa');
  assert.deepEqual(android[0]?.target.sha256_cert_fingerprints, ['41:D9:B6:25:2C:D7:F4:C0:73:D5:4E:2E:35:72:D4:DA:8D:53:31:5C:43:7B:CE:62:31:CB:57:41:9F:27:0F:D7']);
  assert.deepEqual(android[0]?.relation_extensions['delegate_permission/common.handle_all_urls'].dynamic_app_link_components, [{ '/': MOBILE_CALLBACK_PATH }, { '/': '*', exclude: true }]);
});
void test('unverified production identity never inherits QA association', () => {
  assert.deepEqual(appleAssociation('production'), { applinks: { details: [] }, webcredentials: { apps: [] } });
  assert.deepEqual(androidAssociation('production'), []);
});
void test('callback is isolated static HTML with no credential consumption or exchange', async () => {
  const response = mobileFallbackResponse();
  assert.equal(response.headers.get('cache-control'), 'no-store');
  assert.equal(response.headers.get('referrer-policy'), 'no-referrer');
  assert.match(response.headers.get('content-security-policy') ?? '', /default-src 'none'/);
  const html = await response.text();
  assert.match(html, /history\.replaceState\(null,'','\/mobile\/auth\/complete'\)/);
  assert.doesNotMatch(html, /location\.|searchParams|fetch\(|localStorage|sessionStorage|_next|https?:\/\//);
  assert.match(html, /로그인 결과를 확인하거나 로그인을 완료하지 않습니다/);
});
