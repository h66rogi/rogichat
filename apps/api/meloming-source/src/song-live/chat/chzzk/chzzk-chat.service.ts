import { Injectable, Logger } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { StreamPlatform } from '@prisma/client';
import { IChatService, ChatMessage, DonationEvent } from '../chat.types';
import {
  ChzzkChatMessage,
  ChzzkDonationMessage,
  ChzzkChatConfig,
} from './chzzk-chat.types';

/**
 * CHZZK 채팅 수집 서비스
 * socket.io 기반 CHZZK WebSocket 연결
 */
@Injectable()
export class ChzzkChatService implements IChatService {
  private readonly logger = new Logger(ChzzkChatService.name);
  private socket: any = null;
  private connected = false;

  constructor(private readonly eventEmitter: EventEmitter2) {}

  async connect(channelId: string, config?: ChzzkChatConfig): Promise<void> {
    // TODO: socket.io를 사용한 CHZZK WebSocket 연결 구현
    // 1. CHZZK WebSocket 서버에 연결
    // 2. 채팅방 입장
    // 3. 이벤트 리스너 등록
    this.logger.log(`Connecting to CHZZK channel: ${channelId}`);

    // 임시 구현 (실제 구현 필요)
    this.connected = true;

    // 이벤트 리스너 설정 예시
    // this.socket.on('CHAT', (data: ChzzkChatMessage) => {
    //   this.handleChatMessage(data);
    // });
    //
    // this.socket.on('DONATION', (data: ChzzkDonationMessage) => {
    //   this.handleDonation(data);
    // });
  }

  disconnect(): void {
    if (this.socket) {
      this.socket.disconnect();
      this.socket = null;
      this.connected = false;
      this.logger.log('Disconnected from CHZZK');
    }
  }

  isConnected(): boolean {
    return this.connected;
  }

  /**
   * CHZZK 채팅 메시지 처리
   */
  private handleChatMessage(data: ChzzkChatMessage): void {
    const message: ChatMessage = {
      platform: StreamPlatform.CHZZK,
      userId: data.userId,
      nickname: data.nickname,
      message: data.message,
      timestamp: new Date(data.time),
    };

    // EventEmitter2로 chat.message 이벤트 발행
    this.eventEmitter.emit('chat.message', message);
  }

  /**
   * CHZZK 후원(치즈) 메시지 처리
   */
  private handleDonation(data: ChzzkDonationMessage): void {
    const payAmount = data.extras?.payAmount || 0;

    const donation: DonationEvent = {
      platform: StreamPlatform.CHZZK,
      donorId: data.userId,
      donorNickname: data.nickname,
      amount: payAmount,
      amountKRW: payAmount, // CHZZK 치즈는 1치즈 = 1원
      message: data.extras?.message,
      timestamp: new Date(data.time),
    };

    // EventEmitter2로 donation.received 이벤트 발행
    this.eventEmitter.emit('donation.received', donation);
  }
}
