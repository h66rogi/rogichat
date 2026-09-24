export type ChatPlatform = 'chzzk' | 'soop' | 'cime' | 'meloming';

// Inline emote token shipped by chat-service alongside the message body.
// `start`/`end` are byte offsets into Message (UTF-8 indexing — matches
// Go's len(string) semantics on the wire). `imageUrl` is empty when the
// platform did not provide an inline mapping (currently SOOP, which uses
// a per-channel signature catalog).
export interface ChatEmoteToken {
  code: string;
  start: number;
  end: number;
  imageUrl?: string;
  animated?: boolean;
  source?: string;
}

export interface BaseChatEvent {
  id: string;
  type: 'chat' | 'donation';
  sessionId: number;
  platform: ChatPlatform;
  channelId: string;
  streamerName?: string;
  userId: string;
  nickname: string;
  message: string;
  timestamp: string;
  emotes?: ChatEmoteToken[];
}

export interface OverlayChatMessage extends BaseChatEvent {
  type: 'chat';
}

export interface OverlayDonationMessage extends BaseChatEvent {
  type: 'donation';
  amount: number;
  currency?: string;
  amountKrw?: number;
}

export type OverlayChatEvent = OverlayChatMessage | OverlayDonationMessage;
