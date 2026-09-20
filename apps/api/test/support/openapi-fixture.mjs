// Test/export only. Never included in dist or the runtime image.
import { createApi, createConfiguredApi } from '../../dist/application.js';
import { AppModule } from '../../dist/app.module.js';
import { LifecycleState } from '../../dist/common/lifecycle/lifecycle-state.js';
import { AuthController } from '../../dist/modules/auth/auth.controller.js';
import { NativeAuthController } from '../../dist/modules/auth/native-auth.controller.js';
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
  if (shape === 'native-feature') {
    const lifecycle = new LifecycleState();
    const module = AppModule.register(database, lifecycle, auth);
    module.imports.find(entry => entry.module?.name === 'AuthModule').controllers = [AuthController, NativeAuthController];
    const app = await createConfiguredApi(module, new SafeLogger('api', () => {}), lifecycle, config, false, environment);
    return { app, calls, config, database };
  }
  const app = await createApi(database, new SafeLogger('api', () => {}), undefined, auth, media, environment);
  return { app, calls, config, database };
}
