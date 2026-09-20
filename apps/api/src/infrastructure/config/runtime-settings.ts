import { ConfigurationError, readConfig } from './config.js';
import type { Config, Role } from './config.js';
import { readAuthConfig } from './auth-config.js';
import type { AuthConfig } from './auth-config.js';
import { readMediaConfig } from '../../modules/media/adapters/media-store.js';
import type { MediaConfig } from '../../modules/media/adapters/media-store.js';
export interface MediaSettings { config: MediaConfig; scratch: string; decoderSocket?: string }
export interface RuntimeSettings { config: Config; auth?: AuthConfig; media?: MediaSettings }
export function readRuntimeSettings(role: Role): RuntimeSettings {
  const config = readConfig(role);
  const auth = role === 'api' && (config.environment === 'qa' || config.environment === 'production' || process.env.AUTH_SECRET_FILE) ? readAuthConfig(config) : undefined;
  const media = readMediaConfig(config.environment);
  if (process.env.MEDIA_ENABLED !== undefined && !['true', 'false'].includes(process.env.MEDIA_ENABLED)) throw new ConfigurationError('MEDIA_ENABLED');
  const enabled = process.env.MEDIA_ENABLED === 'true';
  if (enabled && (!media || !process.env.MEDIA_SCRATCH_DIR || (role === 'api' ? !auth : !process.env.MEDIA_DECODER_SOCKET))) throw new ConfigurationError('MEDIA_ENABLED');
  return { config, ...(auth ? { auth } : {}), ...(enabled && media ? { media: { config: media, scratch: process.env.MEDIA_SCRATCH_DIR!, ...(role === 'worker' ? { decoderSocket: process.env.MEDIA_DECODER_SOCKET! } : {}) } } : {}) };
}
