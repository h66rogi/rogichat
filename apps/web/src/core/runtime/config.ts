/** Public configuration only. Never infer trust from request headers. */
export interface RuntimeConfig { environment: 'qa' | 'production'; apiOrigin: string; defaultRoomId: string | null; mediaStorageOrigins: string[] }
export function runtimeConfig(env: Record<string, string | undefined> = process.env): RuntimeConfig {
  const environment = env.ROGICHAT_WEB_ENV;
  if (environment !== 'qa' && environment !== 'production') throw new Error('ROGICHAT_WEB_ENV must be qa or production');
  const apiOrigin = environment === 'qa' ? 'https://api.qa.rogi.chat' : 'https://api.rogi.chat';
  if (env.ROGICHAT_API_ORIGIN !== apiOrigin) throw new Error('ROGICHAT_API_ORIGIN does not match environment');
  const defaultRoomId = env.ROGICHAT_DEFAULT_ROOM_ID || null;
  if (defaultRoomId !== null && !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(defaultRoomId)) throw new Error('ROGICHAT_DEFAULT_ROOM_ID must be a UUID');
  const mediaStorageOrigins = storageOrigins(env.ROGICHAT_MEDIA_STORAGE_ORIGINS);
  return { environment, apiOrigin, defaultRoomId, mediaStorageOrigins };
}

/** Explicit deployment input only; no wildcard, response-derived signer or fallback. */
export function storageOrigins(value?: string): string[] {
  if (!value) return [];
  const origins: unknown = JSON.parse(value);
  if (!Array.isArray(origins) || origins.length > 8) throw new Error('Invalid media storage origins');
  for (const origin of origins) {
    if (typeof origin !== 'string') throw new Error('Invalid media storage origin');
    const url = new URL(origin);
    if (url.protocol !== 'https:' || url.origin !== origin || url.username || url.password || url.hostname.includes('*') || ['api.qa.rogi.chat', 'api.rogi.chat'].includes(url.hostname)) throw new Error('Invalid media storage origin');
  }
  if (new Set(origins).size !== origins.length) throw new Error('Duplicate media storage origin');
  return origins as string[];
}
