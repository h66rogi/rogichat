// Node test bootstrap for the pure helpers in this feature. Node 24 strips TypeScript types
// natively but its ESM loader needs explicit file extensions, while the app source uses
// bundler-style extensionless relative imports. This hook appends `.ts` to a relative
// specifier only when that file exists. Usage:
//   node --import ./src/features/chat/testing/register-ts.mjs --test src/features/chat/drafts.test.ts
import { register } from 'node:module';

register('./resolve-ts.mjs', import.meta.url);
