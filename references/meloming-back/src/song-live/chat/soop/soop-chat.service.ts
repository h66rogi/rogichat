import { Injectable, Logger } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { StreamPlatform } from '@prisma/client';
import { IChatService, ChatMessage } from '../chat.types';
import { SoopChatMessage, SoopChatConfig } from './soop-chat.types';

/**
 * SOOP 채팅 수집 서비스
 * TODO: soop-extension 라이브러리 사용 예정
 */
@Injectable()
export class SoopChatService implements IChatService {
  private readonly logger = new Logger(SoopChatService.name);
  private connected = false;

  constructor(private readonly eventEmitter: EventEmitter2) {}

  async connect(channelId: string, config?: SoopChatConfig): Promise<void> {
    // TODO: soop-extension 라이브러리를 사용한 SOOP 채팅 연결 구현
    // 현재는 구조만 생성
    this.logger.log(`TODO: Connect to SOOP channel: ${channelId}`);
    this.connected = true;

    // 향후 구현 예시:
    // const client = new SoopClient();
    // await client.connect(channelId);
    // client.on('chat', (data: SoopChatMessage) => {
    //   this.handleChatMessage(data);
    // });
  }

  disconnect(): void {
    if (this.connected) {
      // TODO: 실제 연결 해제 로직
      this.connected = false;
      this.logger.log('Disconnected from SOOP');
    }
  }

  isConnected(): boolean {
    return this.connected;
  }

  /**
   * SOOP 채팅 메시지 처리
   */
  private handleChatMessage(data: SoopChatMessage): void {
    const message: ChatMessage = {
      platform: StreamPlatform.SOOP,
      userId: data.userId,
      nickname: data.nickname,
      message: data.message,
      timestamp: new Date(data.timestamp),
    };

    // EventEmitter2로 chat.message 이벤트 발행
    this.eventEmitter.emit('chat.message', message);
  }
}
