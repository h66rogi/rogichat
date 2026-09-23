import { test } from 'node:test';
import assert from 'node:assert/strict';
import { rogichatApiOrigin, rogichatCsrfToken } from '../meloming-api-bridge';

void test('copied Meloming client resolves only the matching Rogichat API origin', () => {
  const previous = process.env.ROGICHAT_API_ORIGIN;
  try {
    process.env.ROGICHAT_API_ORIGIN = 'https://api.qa.rogi.chat';
    assert.equal(rogichatApiOrigin(), 'https://api.qa.rogi.chat');
    process.env.ROGICHAT_API_ORIGIN = 'https://api.rogi.chat';
    assert.equal(rogichatApiOrigin(), 'https://api.rogi.chat');
    process.env.ROGICHAT_API_ORIGIN = 'https://api.meloming.com';
    assert.throws(() => rogichatApiOrigin(), /unavailable/);
  } finally {
    if (previous === undefined) delete process.env.ROGICHAT_API_ORIGIN;
    else process.env.ROGICHAT_API_ORIGIN = previous;
  }
});

void test('copied Meloming write client obtains a Rogichat CSRF proof from its session', async () => {
  const previousOrigin = process.env.ROGICHAT_API_ORIGIN;
  const previousFetch = globalThis.fetch;
  try {
    process.env.ROGICHAT_API_ORIGIN = 'https://api.qa.rogi.chat';
    globalThis.fetch = async (input, init) => {
      assert.equal(input, 'https://api.qa.rogi.chat/v1/auth/session');
      assert.equal(init?.credentials, 'include');
      return Response.json({ authenticated: true, csrfToken: 'synthetic-csrf-proof', accountPartition: 'synthetic' });
    };
    assert.equal(await rogichatCsrfToken(), 'synthetic-csrf-proof');
    globalThis.fetch = async () => Response.json({ authenticated: false }, { status: 401 });
    await assert.rejects(rogichatCsrfToken(), /Authentication is required/);
  } finally {
    globalThis.fetch = previousFetch;
    if (previousOrigin === undefined) delete process.env.ROGICHAT_API_ORIGIN;
    else process.env.ROGICHAT_API_ORIGIN = previousOrigin;
  }
});
