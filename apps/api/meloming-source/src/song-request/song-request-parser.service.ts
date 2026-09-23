import { Injectable } from '@nestjs/common';

export interface ParsedSongRequest {
  artist: string;
  title: string;
}

@Injectable()
export class SongRequestParserService {
  private readonly SEPARATORS = ['-', '/', '–', '—'];
  private readonly REQUEST_PREFIXES = ['!신청', '!노래신청', '!곡신청'];

  /**
   * 신청 메시지에서 아티스트와 곡명을 파싱합니다.
   *
   * 지원 형식:
   * - !신청 아이유-좋은날
   * - !신청 아이유 - 좋은날
   * - !신청 아이유/좋은날
   * - !노래신청 BTS - Dynamite
   *
   * @param message 신청 메시지
   * @returns 파싱된 결과 또는 null
   */
  parseRequest(message: string): ParsedSongRequest | null {
    if (!message || typeof message !== 'string') {
      return null;
    }

    // 메시지 정규화 (공백 정리)
    const normalized = message.trim();

    // 신청 접두사 제거
    const content = this.removePrefix(normalized);
    if (!content) {
      return null;
    }

    // 구분자로 분리
    const parsed = this.splitBySeparator(content);
    if (!parsed) {
      return null;
    }

    return parsed;
  }

  /**
   * 신청 접두사를 제거합니다.
   */
  private removePrefix(message: string): string | null {
    for (const prefix of this.REQUEST_PREFIXES) {
      if (message.startsWith(prefix)) {
        return message.substring(prefix.length).trim();
      }
    }
    return null;
  }

  /**
   * 구분자를 찾아 아티스트와 곡명으로 분리합니다.
   */
  private splitBySeparator(content: string): ParsedSongRequest | null {
    for (const separator of this.SEPARATORS) {
      // 구분자 앞뒤 공백을 포함한 패턴으로 검색
      const patterns = [
        ` ${separator} `, // 공백-구분자-공백
        separator, // 구분자만
      ];

      for (const pattern of patterns) {
        const index = content.indexOf(pattern);
        if (index > 0) {
          const artist = content.substring(0, index).trim();
          const title = content.substring(index + pattern.length).trim();

          if (artist && title) {
            return { artist, title };
          }
        }
      }
    }

    return null;
  }

  /**
   * 메시지가 신청 메시지 형식인지 확인합니다.
   */
  isRequestMessage(message: string): boolean {
    if (!message) {
      return false;
    }

    return this.REQUEST_PREFIXES.some((prefix) =>
      message.trim().startsWith(prefix),
    );
  }
}
