import { test } from 'node:test';
import assert from 'node:assert/strict';
import { SafeExceptionFilter } from '../../dist/common/http/safe-exception.filter.js';
import { SafeLogger } from '../../dist/infrastructure/observability/logging.js';
import { DatabaseUnavailableError } from '../../dist/infrastructure/database/database-unavailable.js';

test('overload is retryable 503 with enum-only diagnostics; unknown commit remains 500', () => {
  for (const reason of ['database_admission', 'database_acquisition', 'database_statement_timeout', 'transaction_timeout', 'commit_outcome_unknown']) {
    let status, body, log;
    const headers = {};
    const response = { setHeader: (key, value) => { headers[key] = value; }, status: value => { status = value; return response; }, json: value => { body = value; } };
    const error = reason === 'commit_outcome_unknown' ? new Error(reason, { cause: new Error('private-marker') }) : new DatabaseUnavailableError(reason);
    error.cause = new Error('private-marker');
    new SafeExceptionFilter(new SafeLogger('api', line => { log = line; })).catch(error, { switchToHttp: () => ({ getResponse: () => response }) });
    const unknown = reason === 'commit_outcome_unknown';
    assert.equal(status, unknown ? 500 : 503);
    assert.deepEqual(body, { error: { code: unknown ? 'INTERNAL_ERROR' : 'UNAVAILABLE' } });
    assert.equal(headers['Retry-After'], unknown ? undefined : '1');
    assert.equal(JSON.parse(log).reason, unknown ? 'runtime' : reason);
    assert.ok(!log.includes('private-marker'));
  }
});
