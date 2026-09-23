import { StreamPlatform, UserPlatformVerification } from '@prisma/client';
import { checkAutoVerify } from './auto-verify.util';

describe('checkAutoVerify', () => {
  const createMockVerification = (
    overrides: Partial<UserPlatformVerification> = {},
  ): UserPlatformVerification => ({
    id: 1,
    userId: 1,
    platform: 'CHZZK' as StreamPlatform,
    platformUserId: 'user123',
    platformChannelId: 'ddd2e6d20a6099979254f0be383c1941',
    isVerified: true,
    verifiedAt: new Date(),
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  });

  describe('CHZZK 플랫폼', () => {
    it('채널 ID가 일치하면 자동 인증 성공', () => {
      const verification = createMockVerification({
        platform: 'CHZZK',
        platformChannelId: 'ddd2e6d20a6099979254f0be383c1941',
      });

      const result = checkAutoVerify(
        'CHZZK',
        'ddd2e6d20a6099979254f0be383c1941',
        verification,
      );

      expect(result.canAutoVerify).toBe(true);
      expect(result.platform).toBe('CHZZK');
      expect(result.platformChannelId).toBe('ddd2e6d20a6099979254f0be383c1941');
    });

    it('채널 ID가 대소문자만 다르면 자동 인증 성공 (대소문자 무시)', () => {
      const verification = createMockVerification({
        platform: 'CHZZK',
        platformChannelId: 'DDD2E6D20A6099979254F0BE383C1941',
      });

      const result = checkAutoVerify(
        'CHZZK',
        'ddd2e6d20a6099979254f0be383c1941',
        verification,
      );

      expect(result.canAutoVerify).toBe(true);
    });

    it('채널 ID가 불일치하면 자동 인증 실패 (단축 URL shortCode vs 실제 채널 ID)', () => {
      const verification = createMockVerification({
        platform: 'CHZZK',
        platformChannelId: 'ddd2e6d20a6099979254f0be383c1941',
      });

      // 이 케이스가 원래 버그였음: 단축 URL에서 shortCode만 추출되어 불일치
      const result = checkAutoVerify('CHZZK', 'hwina_2424', verification);

      expect(result.canAutoVerify).toBe(false);
      expect(result.reason).toBe(
        '채널 ID(hwina_2424)가 인증된 ID(ddd2e6d20a6099979254f0be383c1941)와 일치하지 않습니다.',
      );
    });

    it('플랫폼 인증 정보가 없으면 자동 인증 실패', () => {
      const result = checkAutoVerify(
        'CHZZK',
        'ddd2e6d20a6099979254f0be383c1941',
        null,
      );

      expect(result.canAutoVerify).toBe(false);
      expect(result.reason).toBe('CHZZK 플랫폼 인증이 완료되지 않았습니다.');
    });

    it('인증되지 않은 상태면 자동 인증 실패', () => {
      const verification = createMockVerification({
        platform: 'CHZZK',
        isVerified: false,
      });

      const result = checkAutoVerify(
        'CHZZK',
        'ddd2e6d20a6099979254f0be383c1941',
        verification,
      );

      expect(result.canAutoVerify).toBe(false);
      expect(result.reason).toBe('CHZZK 플랫폼 인증이 완료되지 않았습니다.');
    });

    it('채널 ID 추출 실패 시 자동 인증 실패', () => {
      const verification = createMockVerification({ platform: 'CHZZK' });

      const result = checkAutoVerify('CHZZK', null, verification);

      expect(result.canAutoVerify).toBe(false);
      expect(result.reason).toBe(
        'platformUrl에서 채널 ID를 추출할 수 없습니다.',
      );
    });
  });

  describe('SOOP 플랫폼', () => {
    it('채널 ID가 일치하면 자동 인증 성공', () => {
      const verification = createMockVerification({
        platform: 'SOOP',
        platformChannelId: 'testuser123',
      });

      const result = checkAutoVerify('SOOP', 'testuser123', verification);

      expect(result.canAutoVerify).toBe(true);
      expect(result.platform).toBe('SOOP');
    });

    it('플랫폼 불일치 시 자동 인증 실패', () => {
      const verification = createMockVerification({
        platform: 'CHZZK',
        platformChannelId: 'testuser123',
      });

      const result = checkAutoVerify('SOOP', 'testuser123', verification);

      expect(result.canAutoVerify).toBe(false);
      expect(result.reason).toBe(
        '사용자의 인증된 플랫폼(CHZZK)과 채널 플랫폼(SOOP)이 일치하지 않습니다.',
      );
    });
  });

  describe('OTHER 플랫폼', () => {
    it('OTHER 플랫폼은 항상 자동 인증 불가', () => {
      const verification = createMockVerification({ platform: 'OTHER' });

      const result = checkAutoVerify('OTHER', 'anychannel', verification);

      expect(result.canAutoVerify).toBe(false);
      expect(result.reason).toBe('OTHER 플랫폼은 자동 검증이 불가능합니다.');
    });
  });

  describe('CIME 플랫폼', () => {
    it('CIME slug(channelHandle)가 일치하면 자동 인증 성공', () => {
      const verification = createMockVerification({
        platform: 'CIME',
        platformChannelId: 'indongyoo',
      });

      const result = checkAutoVerify('CIME', 'indongyoo', verification);

      expect(result.canAutoVerify).toBe(true);
      expect(result.platform).toBe('CIME');
      expect(result.platformChannelId).toBe('indongyoo');
    });

    it('CIME slug가 일치하지 않으면 자동 인증 실패', () => {
      const verification = createMockVerification({
        platform: 'CIME',
        platformChannelId: 'indongyoo',
      });

      const result = checkAutoVerify('CIME', 'lumoungs2', verification);

      expect(result.canAutoVerify).toBe(false);
      expect(result.reason).toContain('일치하지 않습니다');
    });
  });

  describe('platformUserId 폴백', () => {
    it('platformChannelId가 없으면 platformUserId로 비교', () => {
      const verification = createMockVerification({
        platform: 'CHZZK',
        platformChannelId: null,
        platformUserId: 'user123',
      });

      const result = checkAutoVerify('CHZZK', 'user123', verification);

      expect(result.canAutoVerify).toBe(true);
    });
  });
});
