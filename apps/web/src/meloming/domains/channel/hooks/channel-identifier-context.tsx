"use client";

import { createContext, useContext, type ReactNode } from "react";
import { useParams } from "next/navigation";

const ChannelIdentifierContext = createContext<string | null>(null);

export function ChannelIdentifierProvider({
  identifier,
  children,
}: {
  identifier: string;
  children: ReactNode;
}) {
  return (
    <ChannelIdentifierContext.Provider value={identifier}>
      {children}
    </ChannelIdentifierContext.Provider>
  );
}

/** Public root pages provide their channel explicitly; legacy management routes retain [user]. */
export function useChannelIdentifier(): string {
  const explicitIdentifier = useContext(ChannelIdentifierContext);
  const { user } = useParams();
  return explicitIdentifier ?? (Array.isArray(user) ? user[0] : user) ?? "";
}
