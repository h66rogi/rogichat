/** Public configuration only. Never infer trust from request headers. */
export function runtimeConfig(env: Record<string, string | undefined> = process.env) {
  const environment = env.ROGICHAT_WEB_ENV;
  if (environment !== 'qa' && environment !== 'production') throw new Error('ROGICHAT_WEB_ENV must be qa or production');
  const apiOrigin = environment === 'qa' ? 'https://api.qa.rogi.chat' : 'https://api.rogi.chat';
  if (env.ROGICHAT_API_ORIGIN !== apiOrigin) throw new Error('ROGICHAT_API_ORIGIN does not match environment');
  const defaultRoomId = env.ROGICHAT_DEFAULT_ROOM_ID || null;
  if (defaultRoomId !== null && !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(defaultRoomId)) throw new Error('ROGICHAT_DEFAULT_ROOM_ID must be a UUID');
  return { environment, apiOrigin, defaultRoomId };
}
