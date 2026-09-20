'use client';
import { createContext, useContext, useMemo, type ReactNode } from 'react';
import { ApiClient } from '../api/client';
const ApiContext = createContext<ApiClient | null>(null);
const RoomContext = createContext<string | null>(null);
const MediaOriginsContext = createContext<readonly string[]>([]);
export const useMediaStorageOrigins = () => useContext(MediaOriginsContext);
export const useDefaultRoomId = () => useContext(RoomContext);
export function RuntimeProvider({ apiOrigin, defaultRoomId, mediaStorageOrigins = [], children }: { apiOrigin: string; defaultRoomId: string | null; mediaStorageOrigins?: readonly string[]; children: ReactNode }) {
  const api = useMemo(() => new ApiClient(apiOrigin), [apiOrigin]);
  return <ApiContext.Provider value={api}><RoomContext.Provider value={defaultRoomId}><MediaOriginsContext.Provider value={mediaStorageOrigins}>{children}</MediaOriginsContext.Provider></RoomContext.Provider></ApiContext.Provider>;
}
export function useApi() {
  const api = useContext(ApiContext);
  if (!api) throw new Error('Missing runtime configuration');
  return api;
}
