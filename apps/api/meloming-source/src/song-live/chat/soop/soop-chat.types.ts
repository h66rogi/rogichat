/**
 * SOOP 채팅 메시지 타입
 */
export interface SoopChatMessage {
  userId: string;
  nickname: string;
  message: string;
  timestamp: number;
}

/**
 * SOOP WebSocket 연결 설정
 */
export interface SoopChatConfig {
  channelId: string;
  bjId?: string;
}
