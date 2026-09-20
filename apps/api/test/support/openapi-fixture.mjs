// Test/export only. Never included in dist or the runtime image.
import { createApi } from '../../dist/application.js';
import { SafeLogger } from '../../dist/infrastructure/observability/logging.js';
export async function openApiFixture(shape = 'full', environment = 'test') {
  const calls = [];
  const forbidden = name => () => { calls.push(name); throw new Error(`Unexpected export I/O: ${name}`); };
  const database = { check: forbidden('database.check'), close: async () => {},
    transactions: { read: forbidden('transactions.read'), write: forbidden('transactions.write') } };
  const config = { audience: 'rogi-test', origin: 'https://web.example.invalid', callback: 'https://api.example.invalid/v1/auth/soop/callback',
    secure: environment !== 'local', key: Buffer.alloc(32, 7), broker: undefined };
  const auth = shape === 'health' ? undefined : { config };
  const media = shape === 'full' ? { prefix: 'fixture',
    store: Object.fromEntries(['put', 'read', 'remove', 'signedGet'].map(name => [name, forbidden(`store.${name}`)])),
    spool: { receive: forbidden('spool.receive') } } : undefined;
  const app = await createApi(database, new SafeLogger('api', () => {}), undefined, auth, media, environment);
  return { app, calls, config, database };
}
