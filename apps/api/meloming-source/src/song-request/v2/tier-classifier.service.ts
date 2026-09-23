import { Injectable } from '@nestjs/common';
import { TierClassification } from './types';

/**
 * 채팅 메시지를 Tier 1/2a/2b/3/ignored로 분류한다.
 *
 * 분류 우선순위 (위에서부터 매치):
 *   1) 채널의 requestCommand prefix → tier1 (가장 적극적 매칭)
 *   2) `!신청 / !신청곡 / !노래신청 / !곡신청 / !sr` 변형 → tier1
 *   3) `신청 ` prefix (`!` 없이, 봇/잡담 제외) → tier2a
 *   4) `!` prefix + 신청 alias whitelist (`!sr` 외) → tier2b
 *   5) 메시지 중간에 `신청` 포함 + 신청 동사 → tier3
 *   6) 그 외 → ignored
 *
 * ClickHouse 490M chat 분석 결과 적용:
 *   - `!`로 시작하는 1.6M 메시지의 대부분이 신청과 무관 (`!출첵 / !멤버 / !투표`).
 *     → Tier 2b는 화이트리스트로 좁힘.
 *   - `신청` prefix 96K 중 대부분이 봇 응답(`신청이 완료되었습니다`)과 잡담.
 *     → Tier 2a/3에 noise 패턴 필터 적용.
 *   - `신청` 포함 283K 중 진짜 신청은 동사 형태(`신청합니다 / 신청이요`)로 등장.
 *     → Tier 3는 동사 화이트리스트와 결합해야 의미 있음.
 */
@Injectable()
export class TierClassifierService {
  // Tier 1으로 직행하는 모든 prefix.
  // 길이 내림차순으로 정렬되어 있어야 `!신청곡`이 `!신청`보다 먼저 매치된다.
  private static readonly TIER1_PREFIXES = [
    '!노래신청', // 5
    '!신청곡', // 4
    '!곡신청', // 4
    '!신청', // 3
  ];

  // Tier 2b 진입을 허용하는 `!` prefix 명령 (신청 alias)
  private static readonly TIER2B_WHITELIST = ['!sr'];

  // Tier 2a/3 진입을 막는 noise prefix.
  // `신청이 완료되었습니다`(봇), `수강신청`(잡담), `갱신 신청` 등.
  // ClickHouse 샘플 기반.
  private static readonly TIER2A_NOISE_PREFIXES = [
    '신청이 완료', // 봇 응답
    '신청 실패', // 봇 응답
    '신청자', // 잡담
    '신청창', // 잡담
    '신청은', // 잡담
    '신청을', // 잡담
    '신청에', // 잡담
    '신청도', // 잡담
    '신청이용', // 잡담
    '신청이야', // 잡담
    '신청한사람', // 잡담
    '신청해야', // 잡담
    '신청햇', // 잡담
    '신청할꺼', // 잡담
    '신청할까', // 잡담
    '신청해서', // 잡담
    '신청하고', // 잡담 (애매: "신청하고 싶다" 등은 신청 의도지만 prefix로는 무시)
  ];

  // Tier 3 통과를 위한 신청 동사 패턴 (메시지 어디든 등장).
  // `신청곡` 합성어 변형도 포함 — `신청곡 해도될까요`, `신청곡 해도되나요` 등.
  private static readonly TIER3_REQUEST_VERBS = [
    '신청합니다',
    '신청이요',
    '신청해주세요',
    '신청 부탁',
    '신청부탁',
    '신청드려요',
    '신청드립니다',
    '신청해도',
    '신청가능',
    '신청할게요',
    '신청할께요',
    '신청해요',
    '신청곡 해도',
    '신청곡 가능',
    '신청곡 부탁',
    '신청곡 받',
  ];

  // Tier 3에서 봇 응답 / 광고 / 잡담을 거르는 noise substrings.
  private static readonly TIER3_NOISE_SUBSTRINGS = [
    '🎵 신청',
    '신청이 완료',
    '신청 실패',
    '신청곡 리스트에 추가',
    '신청곡 양식',
    '수강신청',
    '가입신청',
    '교환신청',
    '산재신청',
    '현피신청',
    '재입고 알림신청',
    '재입고알림신청',
    '갱신 신청',
    '면허신청',
    '청구신청',
    '환불신청',
  ];

  /**
   * @param rawMessage 채팅 원문 (trim 전)
   * @param requestCommand 채널 설정의 requestCommand. default `!신청`.
   */
  classify(rawMessage: string, requestCommand = '!신청'): TierClassification {
    if (!rawMessage) {
      return { tier: 'ignored', reason: 'no_signal', payload: '' };
    }
    const message = rawMessage.trim();
    if (!message) {
      return { tier: 'ignored', reason: 'no_signal', payload: '' };
    }

    // 1+2) 채널 requestCommand + 표준 변형을 모두 모아 길이 내림차순으로 매치.
    //   - `!신청곡`이 `!신청`보다 우선해야 payload가 잘리지 않음.
    //   - reason 구분: requestCommand match → request_command_prefix
    //                 표준 변형 match → exclam_request_variant
    type PrefixCandidate = {
      prefix: string;
      reason: 'request_command_prefix' | 'exclam_request_variant';
    };
    const candidates: PrefixCandidate[] = [];
    if (requestCommand) {
      candidates.push({ prefix: requestCommand, reason: 'request_command_prefix' });
    }
    for (const p of TierClassifierService.TIER1_PREFIXES) {
      if (p !== requestCommand) {
        candidates.push({ prefix: p, reason: 'exclam_request_variant' });
      }
    }
    candidates.sort((a, b) => b.prefix.length - a.prefix.length);

    for (const { prefix, reason } of candidates) {
      if (message.startsWith(prefix)) {
        const payload = message.substring(prefix.length).trim();
        return { tier: 'tier1', reason, payload };
      }
    }

    // 3) `신청 ` prefix (`!` 없이) — noise 필터 통과 시 tier2a
    if (message.startsWith('신청')) {
      // noise prefix 필터
      for (const noise of TierClassifierService.TIER2A_NOISE_PREFIXES) {
        if (message.startsWith(noise)) {
          return {
            tier: 'ignored',
            reason: noise.startsWith('신청이 완료') || noise === '신청 실패'
              ? 'bot_message'
              : 'noise_word',
            payload: '',
          };
        }
      }
      // `신청` 한 글자 단독, 또는 `신청 ` 형태만 통과
      const after = message.substring('신청'.length);
      if (after === '' || /^[\s,!?.]/u.test(after)) {
        const payload = after.trim();
        if (!payload) {
          return { tier: 'ignored', reason: 'no_signal', payload: '' };
        }
        return {
          tier: 'tier2a',
          reason: 'request_word_prefix',
          payload,
        };
      }
      // `신청곡` 같은 합성어로 시작하면 Tier 3 후보로 떨어뜨림 (verb 검사 필요)
    }

    // 4) `!` prefix whitelist → tier2b
    if (message.startsWith('!')) {
      for (const cmd of TierClassifierService.TIER2B_WHITELIST) {
        if (
          message === cmd ||
          message.startsWith(`${cmd} `) ||
          message.startsWith(`${cmd}\t`)
        ) {
          const payload = message.substring(cmd.length).trim();
          return {
            tier: 'tier2b',
            reason: 'exclam_whitelisted_command',
            payload,
          };
        }
      }
      // separator(`-`/`/`/`–`/`—`) 포함 시 신청 의도 강함 → tier2b 진입.
      // `!출첵 / !멤버 / !공지`처럼 단어 단독 명령어는 separator 없으니 통과 안 함.
      // `!아이유 - 밤편지`, `!IU/좋은날`, `!10cm-봄이 좋냐` 모두 cover.
      // separator 양쪽에 한 글자 이상 있어야 함 (`!--` 같은 노이즈 제외).
      const after = message.substring(1).trim();
      const hasSeparator = /\S[-/–—]\S|\S [-/–—] \S/.test(after);
      if (hasSeparator && after.length >= 3) {
        return {
          tier: 'tier2b',
          reason: 'exclam_whitelisted_command',
          payload: after,
        };
      }
      // 화이트리스트도 아니고 separator도 없으면 ignored (1.6M `!출첵 / !멤버` 등)
      return { tier: 'ignored', reason: 'no_signal', payload: '' };
    }

    // 5) 메시지 중간에 `신청` 포함 + 신청 동사 → tier3
    if (message.includes('신청')) {
      // noise substring 우선 검사
      for (const noise of TierClassifierService.TIER3_NOISE_SUBSTRINGS) {
        if (message.includes(noise)) {
          return {
            tier: 'ignored',
            reason: noise.includes('🎵') || noise.includes('완료')
              ? 'bot_message'
              : 'noise_word',
            payload: '',
          };
        }
      }
      // 신청 동사 패턴 매칭
      const hasVerb = TierClassifierService.TIER3_REQUEST_VERBS.some((v) =>
        message.includes(v),
      );
      if (hasVerb) {
        return {
          tier: 'tier3',
          reason: 'request_word_contained',
          payload: message,
        };
      }
      // 동사 없이 `신청`만 들어있으면 무시 (`내 신청곡`, `신청곡 양식` 등)
      return { tier: 'ignored', reason: 'no_signal', payload: '' };
    }

    return { tier: 'ignored', reason: 'no_signal', payload: '' };
  }
}
