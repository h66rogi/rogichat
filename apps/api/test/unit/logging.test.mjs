import { test } from 'node:test';
import assert from 'node:assert/strict';
import { SafeLogger } from '../../dist/logging.js';

test('structured logs discard secrets, errors, headers, URLs and untrusted context', () => {
  let output = '';
  new SafeLogger('api', (line) => { output += line; }).event('request', {
    status: 503, route: 'unmatched', durationMs: 1.9, reason: 'database_unavailable',
    authorization: 'secret-marker', cookie: 'secret-marker', body: 'secret-marker',
    error: new Error('secret-marker'), databaseUrl: 'mysql://secret-marker',
    requestId: 'secret-marker', url: '/?X-Amz-Signature=secret-marker',
  });
  assert.ok(!output.includes('secret-marker'));
  assert.deepEqual(Object.keys(JSON.parse(output)).sort(), ['durationMs', 'event', 'reason', 'role', 'route', 'status', 'timestamp']);
});

test('unsafe enum and non-finite numeric metadata are discarded', () => {
  let output = '';
  new SafeLogger('worker', (line) => { output = line; }).event('readiness_changed', { reason: 'secret-marker', route: 'secret-marker', status: NaN });
  assert.ok(!output.includes('secret-marker'));
});
