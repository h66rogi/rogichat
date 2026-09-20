import assert from 'node:assert/strict';
import test from 'node:test';
import { runtimeConfig } from './config';
void test('one artifact accepts only explicit matching runtime origin pairs', () => {
  assert.deepEqual(runtimeConfig({ ROGICHAT_WEB_ENV: 'qa', ROGICHAT_API_ORIGIN: 'https://api.qa.rogi.chat' }), { environment: 'qa', apiOrigin: 'https://api.qa.rogi.chat', defaultRoomId: null });
  assert.equal(runtimeConfig({ ROGICHAT_WEB_ENV: 'production', ROGICHAT_API_ORIGIN: 'https://api.rogi.chat' }).apiOrigin, 'https://api.rogi.chat');
  for (const env of [{}, { ROGICHAT_WEB_ENV: 'qa' }, { ROGICHAT_WEB_ENV: 'qa', ROGICHAT_API_ORIGIN: 'https://api.rogi.chat' }, { ROGICHAT_WEB_ENV: 'production', ROGICHAT_API_ORIGIN: 'https://api.qa.rogi.chat' }]) assert.throws(() => runtimeConfig(env));
});
void test('default room is optional, exact UUID only, and never chosen from request data', () => {
  const env = { ROGICHAT_WEB_ENV: 'qa', ROGICHAT_API_ORIGIN: 'https://api.qa.rogi.chat' };
  assert.equal(runtimeConfig({ ...env, ROGICHAT_DEFAULT_ROOM_ID: '' }).defaultRoomId, null);
  assert.equal(runtimeConfig({ ...env, ROGICHAT_DEFAULT_ROOM_ID: '11111111-1111-4111-8111-111111111111' }).defaultRoomId, '11111111-1111-4111-8111-111111111111');
  for (const value of ['first', '후로기', 'invalid', '../rooms', ' ']) assert.throws(() => runtimeConfig({ ...env, ROGICHAT_DEFAULT_ROOM_ID: value }));
});
