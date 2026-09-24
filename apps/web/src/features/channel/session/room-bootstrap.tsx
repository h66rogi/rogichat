'use client';
import { createContext, useContext, type ReactNode } from 'react';
import type { ChannelBootstrap } from '@/core/server/channel-bootstrap';

const RoomBootstrapContext = createContext<ChannelBootstrap | null>(null);
export function RoomBootstrapProvider({ initial, children }: { initial: ChannelBootstrap | null; children: ReactNode }) {
  return <RoomBootstrapContext.Provider value={initial}>{children}</RoomBootstrapContext.Provider>;
}
export const useRoomBootstrap = () => useContext(RoomBootstrapContext);
