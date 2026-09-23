import { StreamPlatform } from '@prisma/client';

/**
 * 공통 채팅 메시지 인터페이스
 */
export interface ChatMessage {
  platform: StreamPlatform;
  channelId?: number; // 채널룸 브로드캐스트용 (optional for backward compatibility)
  userId: string;
  nickname: string;
  message: string;
  type?: 'chat' | 'donation'; // 메시지 타입 구분 (optional for backward compatibility)
  donationAmount?: number;
  donationNativeAmount?: number;
  donationCurrency?: string;
  timestamp: Date;
}

/**
 * 공통 후원 이벤트 인터페이스
 */
export interface DonationEvent {
  platform: StreamPlatform;
  donorId: string;
  donorNickname: string;
  amount: number;
  amountKRW: number;
  message?: string;
  timestamp: Date;
}

/**
 * 채팅 서비스 공통 인터페이스
 */
export interface IChatService {
  /**
   * 채팅 연결 시작
   */
  connect(channelId: string): Promise<void>;

  /**
   * 채팅 연결 종료
   */
  disconnect(): void;

  /**
   * 연결 상태 확인
   */
  isConnected(): boolean;
}
