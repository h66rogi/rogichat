'use client';
import { createContext, useContext, useMemo, type ReactNode } from 'react';
import { ApiClient } from '../api/client';
const ApiContext = createContext<ApiClient | null>(null);
const RoomContext = createContext<string | null>(null);
export const useDefaultRoomId = () => useContext(RoomContext);
export function RuntimeProvider({ apiOrigin, defaultRoomId, children }: { apiOrigin: string; defaultRoomId: string | null; children: ReactNode }) {
  const api = useMemo(() => new ApiClient(apiOrigin), [apiOrigin]);
  return <ApiContext.Provider value={api}><RoomContext.Provider value={defaultRoomId}>{children}</RoomContext.Provider></ApiContext.Provider>;
}
export function useApi() {
  const api = useContext(ApiContext);
  if (!api) throw new Error('Missing runtime configuration');
  return api;
}
