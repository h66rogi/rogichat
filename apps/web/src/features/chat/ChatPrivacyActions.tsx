'use client';
import { createContext, useContext } from 'react';
import type { Session } from '@/core/api/client';
import { MessageModerationControl, PublicationControl } from '@/features/privacy';
import type { ChatController } from './chat-controller';

export const ChatPrivacyContext = createContext<{ origin: string; session: Session; controller: ChatController } | null>(null);
export function ChatPrivacyActions({ messageId }: { messageId: string }) {
  const context = useContext(ChatPrivacyContext);
  if (!context) return null;
  const current = context.controller.privacyContext(messageId);
  if (!current) return null;
  const props = { ...current, origin: context.origin, session: context.session };
  return <div className="space-y-3 text-sm">
    <PublicationControl {...props} onPublished={() => { void context.controller.refreshHints(); }} />
    <MessageModerationControl {...props} onReset={() => { void context.controller.refreshHints(); }} />
  </div>;
}
