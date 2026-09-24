'use client';

import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';

import type { OverlayChatEvent } from '@/domains/overlay/types/chat';

/**
 * ChatMessagesContext
 *
 * Why this exists:
 *   The unified overlay (`/widgets/total`) used to keep `chatMessages` in
 *   the root component's `useState`. In streams with active chat the WS
 *   `chat.message` / `chat.donation` events fire many times per second
 *   (especially during chat surges or donation bursts), so every append
 *   caused the entire root component to re-render — even though only the
 *   chatbox sub-widget actually reads chat. The other three sub-widgets
 *   (queue, now-playing, setlist) were paying for re-renders they didn't
 *   need.
 *
 *   The chat events DO reach the total widget: gateway-service joins
 *   `widget:{token}:total` sockets to the `widget:{token}:chat` room when
 *   `widgetType` is `total` (see `meloming-gateway-service/src/overlay/
 *   overlay.gateway.ts` `needsChatBridge`), so the chat fanout reaches us
 *   even though `meloming-back/src/overlay-stream/overlay-stream.events.
 *   service.ts` only publishes to `widgetType: chat`.
 *
 * Solution:
 *   Hold the `chatMessages` state inside a dedicated Provider. The root
 *   component uses `useChatMessagesActions()` (a stable setter bag from
 *   this context) inside the WS callback, but never subscribes to the
 *   value — so chat updates do NOT re-render the root. Only components
 *   that call `useChatMessages()` re-render when chat changes; for the
 *   total overlay that's just the small Chatbox bridge.
 *
 * Pattern:
 *   Two contexts (value + actions) are intentionally separated so consumers
 *   that only need to *update* the buffer don't re-render when chat
 *   changes, and consumers that only need to *read* aren't given setters
 *   that would needlessly invalidate their memo references.
 *
 *   The `append` action is responsible for:
 *     - dedup by `id` (replace existing entry, preserves stable order)
 *     - trim to `maxMessages` from the tail (latest-N)
 *
 *   `maxMessages` is configured via `setMaxMessages` (called from the
 *   chat theme's `mergedChatThemeOptions.maxMessages`). When unset or
 *   invalid, `DEFAULT_MAX_CHAT_MESSAGES` is used. This mirrors the
 *   previous `chatMaxRef` behaviour exactly.
 */

export const DEFAULT_MAX_CHAT_MESSAGES = 50;

interface ChatMessagesActions {
  append: (message: OverlayChatEvent) => void;
  clear: () => void;
  setMessages: (messages: OverlayChatEvent[]) => void;
  setMaxMessages: (max: number | null) => void;
}

const NOOP_ACTIONS: ChatMessagesActions = {
  append: () => {
    /* no-op when no provider mounted */
  },
  clear: () => {
    /* no-op when no provider mounted */
  },
  setMessages: () => {
    /* no-op when no provider mounted */
  },
  setMaxMessages: () => {
    /* no-op when no provider mounted */
  },
};

const ChatMessagesValueContext = createContext<OverlayChatEvent[]>([]);
const ChatMessagesActionsContext =
  createContext<ChatMessagesActions>(NOOP_ACTIONS);

interface ChatMessagesProviderProps {
  children: ReactNode;
  initialMessages?: OverlayChatEvent[];
  initialMaxMessages?: number | null;
}

export function ChatMessagesProvider({
  children,
  initialMessages,
  initialMaxMessages,
}: ChatMessagesProviderProps) {
  const [messages, setMessagesState] = useState<OverlayChatEvent[]>(
    initialMessages ?? [],
  );

  // `maxMessages` is held in a ref so updating it does not re-render
  // consumers of the value context. The `append` closure reads from the
  // ref each call so it always uses the current limit.
  const maxMessagesRef = useRef<number | null>(initialMaxMessages ?? null);

  const append = useCallback<ChatMessagesActions['append']>((message) => {
    setMessagesState((prev) => {
      const raw = maxMessagesRef.current;
      const parsed = Number(raw);
      const maxMessages =
        Number.isFinite(parsed) && parsed > 0
          ? parsed
          : DEFAULT_MAX_CHAT_MESSAGES;
      const next = [
        ...prev.filter((item) => item.id !== message.id),
        message,
      ];
      return next.slice(-maxMessages);
    });
  }, []);

  const clear = useCallback<ChatMessagesActions['clear']>(() => {
    setMessagesState([]);
  }, []);

  const setMessages = useCallback<ChatMessagesActions['setMessages']>(
    (next) => {
      setMessagesState(next);
    },
    [],
  );

  const setMaxMessages = useCallback<ChatMessagesActions['setMaxMessages']>(
    (max) => {
      maxMessagesRef.current = max;
    },
    [],
  );

  // Keep the actions object identity stable so consumers that depend only
  // on actions never re-render due to chat updates.
  const actions = useMemo<ChatMessagesActions>(
    () => ({ append, clear, setMessages, setMaxMessages }),
    [append, clear, setMessages, setMaxMessages],
  );

  return (
    <ChatMessagesActionsContext.Provider value={actions}>
      <ChatMessagesValueContext.Provider value={messages}>
        {children}
      </ChatMessagesValueContext.Provider>
    </ChatMessagesActionsContext.Provider>
  );
}

/** Subscribe to chat messages. Re-renders the caller when the buffer changes. */
export function useChatMessages(): OverlayChatEvent[] {
  return useContext(ChatMessagesValueContext);
}

/** Get stable actions for the chat buffer. Does NOT subscribe to value updates. */
export function useChatMessagesActions(): ChatMessagesActions {
  return useContext(ChatMessagesActionsContext);
}
