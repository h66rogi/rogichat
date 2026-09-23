import { TierClassifierService } from './tier-classifier.service';

describe('TierClassifierService', () => {
  let svc: TierClassifierService;

  beforeEach(() => {
    svc = new TierClassifierService();
  });

  describe('Tier 1', () => {
    it('채널 requestCommand prefix가 우선 매치된다', () => {
      const r = svc.classify('!신청 아이유 - 좋은날', '!신청');
      expect(r.tier).toBe('tier1');
      expect(r.reason).toBe('request_command_prefix');
      expect(r.payload).toBe('아이유 - 좋은날');
    });

    it.each([
      ['!신청곡 한로로 사랑하게 될 거야', '한로로 사랑하게 될 거야'],
      ['!노래신청 BTS Dynamite', 'BTS Dynamite'],
      ['!곡신청 IU 밤편지', 'IU 밤편지'],
      ['!신청 어푸 아이유', '어푸 아이유'],
    ])('표준 prefix 변형 → tier1: %s', (input, expectedPayload) => {
      const r = svc.classify(input);
      expect(r.tier).toBe('tier1');
      expect(['request_command_prefix', 'exclam_request_variant']).toContain(
        r.reason,
      );
      expect(r.payload).toBe(expectedPayload);
    });

    it('`!신청곡`이 `!신청`보다 우선 매치 (긴 prefix 우선)', () => {
      const r = svc.classify('!신청곡 abc');
      expect(r.payload).toBe('abc');
    });

    it('YouTube URL 신청도 tier1', () => {
      const r = svc.classify(
        '!신청 https://youtu.be/abc?si=xyz',
      );
      expect(r.tier).toBe('tier1');
      expect(r.payload).toBe('https://youtu.be/abc?si=xyz');
    });
  });

  describe('Tier 2a', () => {
    it('`신청 ` prefix → tier2a', () => {
      const r = svc.classify('신청 Never Ending Story');
      expect(r.tier).toBe('tier2a');
      expect(r.reason).toBe('request_word_prefix');
      expect(r.payload).toBe('Never Ending Story');
    });

    it('`신청` 단독은 payload 없어 ignored', () => {
      const r = svc.classify('신청');
      expect(r.tier).toBe('ignored');
    });

    it.each([
      '신청이 완료되었습니다: BTS - Dynamite', // 봇
      '신청 실패: 인당 최대 신청 곡 수(5곡)를 초과', // 봇
      '신청자가 170명이 넘은건에 대하여',
      '신청은 어떻게 하나요',
      '신청을 어디서 하지',
      '신청도 있고 티켓팅도 있고',
      '신청이용 ㅎㅎㅎ',
      '신청이야 뭐야 어떤시스템이야?',
      '신청한사람 ㅈㄴ많다던데',
      '신청해야 해?',
      '신청햇자나',
      '신청할꺼면 글 올려줘',
      '신청할까요 ??',
      '신청해서 업 누르는데',
    ])('Tier 2a noise prefix → ignored: %s', (input) => {
      const r = svc.classify(input);
      expect(r.tier).toBe('ignored');
    });
  });

  describe('Tier 2b', () => {
    it('`!sr` 화이트리스트 → tier2b', () => {
      const r = svc.classify('!sr search keyword');
      expect(r.tier).toBe('tier2b');
      expect(r.payload).toBe('search keyword');
    });

    it.each([
      ['!아이유 - 밤편지', '아이유 - 밤편지'],
      ['!BTS / Dynamite', 'BTS / Dynamite'],
      ['!10cm-봄이 좋냐', '10cm-봄이 좋냐'],
    ])('`!` + separator → tier2b: %s', (input, expectedPayload) => {
      const r = svc.classify(input);
      expect(r.tier).toBe('tier2b');
      expect(r.payload).toBe(expectedPayload);
    });

    it.each([
      '!출첵',
      '!일정',
      '!멤버',
      '!공지',
      '!투표 1',
      '!프로필',
      '!sql injection', // !sr 아닌 다른 명령
      '!공격 전석탄',
    ])('`!` 비-whitelist → ignored: %s', (input) => {
      const r = svc.classify(input);
      expect(r.tier).toBe('ignored');
    });
  });

  describe('Tier 3', () => {
    it.each([
      '봄여름가을겨울 신청합니다 ㄱㄱ',
      '김필 사랑하나 신청이요',
      '떄마님 신청곡 해도될까요', // "신청해도" 포함
      '폐허도 신청가능합니까',
      '저 혹시 누나 - 안녕 신청해주세요',
    ])('신청 동사 + `신청` 포함 → tier3: %s', (input) => {
      const r = svc.classify(input);
      expect(r.tier).toBe('tier3');
      expect(r.reason).toBe('request_word_contained');
      expect(r.payload).toBe(input.trim());
    });

    it.each([
      '🎵 신청이 완료되었습니다: foo', // 봇
      '내 신청곡', // 동사 없음
      '챈나도 신청했나?', // 의문, 신청 의도 X
      '수강신청할때 항상 씀',
      '재입고 알림신청 하셔야 할 거예요',
      '갱신 신청했는데 자꾸 해외나가고',
      '🎵 신청곡: Michael Jackson - Smooth Criminal',
    ])('Tier 3 noise → ignored: %s', (input) => {
      const r = svc.classify(input);
      expect(r.tier).toBe('ignored');
    });
  });

  describe('edge cases', () => {
    it('빈 문자열 → ignored', () => {
      expect(svc.classify('').tier).toBe('ignored');
      expect(svc.classify('   ').tier).toBe('ignored');
    });

    it('일반 채팅 → ignored', () => {
      expect(svc.classify('안녕하세요').tier).toBe('ignored');
      expect(svc.classify('ㅋㅋㅋㅋ').tier).toBe('ignored');
    });

    it('채널 requestCommand가 다른 값일 때', () => {
      const r = svc.classify('!요청 아이유 좋은날', '!요청');
      expect(r.tier).toBe('tier1');
      expect(r.payload).toBe('아이유 좋은날');
    });
  });
});
