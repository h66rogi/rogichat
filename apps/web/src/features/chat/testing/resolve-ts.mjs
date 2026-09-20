import { existsSync } from 'node:fs';
import { URL, fileURLToPath } from 'node:url';

const RELATIVE = /^\.\.?\//;
const HAS_EXTENSION = /\.[cm]?[jt]sx?$|\.json$/;

/** @type {import('node:module').ResolveHook} */
export function resolve(specifier, context, nextResolve) {
  if (RELATIVE.test(specifier) && !HAS_EXTENSION.test(specifier) && context.parentURL) {
    const candidate = new URL(`${specifier}.ts`, context.parentURL);
    if (existsSync(fileURLToPath(candidate))) {
      return nextResolve(candidate.href, context);
    }
  }
  return nextResolve(specifier, context);
}
