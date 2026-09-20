import { writeFile } from 'node:fs/promises';
import { readStateOpenApi } from '../../apps/api/dist/modules/read-state/read-state.openapi.js';
import { notificationsOpenApi } from '../../apps/api/dist/modules/notifications/dto/notifications.openapi.js';

// Run after the API build; exported fragments and the published artifact share
// one composition path. No runtime configuration or secrets are read.
export const m11OpenApi = {
  openapi: '3.0.3',
  info: { title: '로기챗 own read state and notifications', version: '1.0.0',
    description: 'Own-state endpoints. WEB mutations require the existing same-origin Origin and x-csrf-token proof with session cookie. Native Bearer requests require X-Rogi-Client ios or android and forbid cookies and CSRF headers. Malformed or mixed credentials return 400; Origin checks may precede session checks. Native preference read/disable and read-state are supported; native push enable/registration/removal return 503 until a native provider exists. Queue ACK is not notification receipt or read proof.' },
  security: [{ WebSession: [] }, { NativeBearer: [], NativeClient: [] }],
  paths: { ...readStateOpenApi.paths, ...notificationsOpenApi.paths },
  components: {
    securitySchemes: {
      WebSession: { type: 'apiKey', in: 'cookie', name: '__Host-rogi_session', description: 'Hosted cookie name; local development uses rogi_session.' },
      NativeBearer: { type: 'http', scheme: 'bearer' },
      NativeClient: { type: 'apiKey', in: 'header', name: 'X-Rogi-Client', description: 'Exactly ios or android.' },
    },
    schemas: { ...readStateOpenApi.schemas, ...notificationsOpenApi.schemas },
  },
};

if (process.argv[1] && new URL(process.argv[1], 'file:').href === import.meta.url) {
  await writeFile(new URL('./m11.openapi.json', import.meta.url), `${JSON.stringify(m11OpenApi, null, 2)}\n`);
}
