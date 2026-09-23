/**
 * CHZZK 채팅 메시지 타입
 */
export interface ChzzkChatMessage {
  userId: string;
  nickname: string;
  message: string;
  extras?: {
    chatType?: string;
    emojis?: unknown;
    osType?: string;
    streamingChannelId?: string;
  };
  time: number;
}

/**
 * CHZZK 후원(치즈) 메시지 타입
 */
export interface ChzzkDonationMessage {
  userId: string;
  nickname: string;
  extras?: {
    payAmount?: number;
    message?: string;
  };
  time: number;
}

/**
 * CHZZK WebSocket 연결 설정
 */
export interface ChzzkChatConfig {
  channelId: string;
  chatChannelId?: string;
  accessToken?: string;
}
