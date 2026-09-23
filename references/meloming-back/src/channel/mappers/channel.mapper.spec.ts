import { ChannelVerificationStatus } from '@prisma/client';
import { toChannelSummaryDto, toChannelDetailDto } from './channel.mapper';

const baseChannel = {
  id: 1,
  name: '테스트 채널',
  webPath: 'test_channel',
  platformUrl: null,
  topBannerUrl: null,
  leftBannerUrl: null,
  leftBannerLink: null,
  rightBannerUrl: null,
  rightBannerLink: null,
  profileImageUrl: null,
  themeColor: '#3B82F6',
  channelDescription: null,
  scheduleNotice: null,
  additionalLinks: [],
  verifications: [],
};

describe('toChannelSummaryDto', () => {
  it('visibility가 UNLISTED이면 그대로 매핑해야 함', () => {
    const result = toChannelSummaryDto({
      ...baseChannel,
      visibility: 'UNLISTED',
    });

    expect(result.visibility).toBe('UNLISTED');
  });

  it('visibility가 PUBLIC이면 그대로 매핑해야 함', () => {
    const result = toChannelSummaryDto({
      ...baseChannel,
      visibility: 'PUBLIC',
    });

    expect(result.visibility).toBe('PUBLIC');
  });

  it('visibility가 없으면 PUBLIC으로 기본값 매핑해야 함', () => {
    const result = toChannelSummaryDto(baseChannel);

    expect(result.visibility).toBe('PUBLIC');
  });

  it('verification이 APPROVED이면 isVerified가 true여야 함', () => {
    const result = toChannelSummaryDto({
      ...baseChannel,
      verifications: [{ status: ChannelVerificationStatus.APPROVED }],
    });

    expect(result.isVerified).toBe(true);
  });

  it('verifications가 빈 배열이면 isVerified가 false여야 함', () => {
    const result = toChannelSummaryDto(baseChannel);

    expect(result.isVerified).toBe(false);
  });

  it('APPROVED 인증의 platformChannelId가 응답에 포함되어야 함', () => {
    const result = toChannelSummaryDto({
      ...baseChannel,
      verifications: [
        { status: ChannelVerificationStatus.APPROVED, platform: 'SOOP', platformChannelId: 'soop123' },
        { status: ChannelVerificationStatus.APPROVED, platform: 'CHZZK', platformChannelId: null },
        { status: ChannelVerificationStatus.PENDING, platform: 'CIME', platformChannelId: 'cime456' },
      ],
    });

    expect(result.verifications).toEqual([
      { platform: 'SOOP', platformChannelId: 'soop123' },
      { platform: 'CHZZK', platformChannelId: null },
    ]);
  });

  it('배너 링크가 설정되면 응답에 포함되어야 함', () => {
    const result = toChannelSummaryDto({
      ...baseChannel,
      leftBannerUrl: 'https://example.com/left.jpg',
      leftBannerLink: 'https://sponsor-left.com',
      rightBannerUrl: 'https://example.com/right.jpg',
      rightBannerLink: 'https://sponsor-right.com',
    });

    expect(result.leftBannerUrl).toBe('https://example.com/left.jpg');
    expect(result.leftBannerLink).toBe('https://sponsor-left.com');
    expect(result.rightBannerUrl).toBe('https://example.com/right.jpg');
    expect(result.rightBannerLink).toBe('https://sponsor-right.com');
  });

  it('배너 링크가 null이면 null로 매핑해야 함', () => {
    const result = toChannelSummaryDto(baseChannel);

    expect(result.leftBannerLink).toBeNull();
    expect(result.rightBannerLink).toBeNull();
  });

  it('배너 링크가 undefined이면 null로 변환해야 함', () => {
    const { leftBannerLink, rightBannerLink, ...channelWithoutLinks } = baseChannel;
    const result = toChannelSummaryDto(channelWithoutLinks as any);

    expect(result.leftBannerLink).toBeNull();
    expect(result.rightBannerLink).toBeNull();
  });

  it('모든 기본 필드가 올바르게 매핑되어야 함', () => {
    const result = toChannelSummaryDto(baseChannel);

    expect(result.id).toBe(1);
    expect(result.name).toBe('테스트 채널');
    expect(result.webPath).toBe('test_channel');
    expect(result.platformUrl).toBeNull();
    expect(result.topBannerUrl).toBeNull();
    expect(result.leftBannerUrl).toBeNull();
    expect(result.leftBannerLink).toBeNull();
    expect(result.rightBannerUrl).toBeNull();
    expect(result.rightBannerLink).toBeNull();
    expect(result.profileImageUrl).toBeNull();
    expect(result.themeColor).toBe('#3B82F6');
    expect(result.channelDescription).toBeNull();
  });
});

// 최소 mock — toChannelDetailDto 에 필요한 필드만 포함
const baseDetailChannel = {
  ...baseChannel,
  userId: 100,
  createdAt: new Date('2024-01-01'),
  updatedAt: new Date('2024-01-01'),
  user: {
    id: 100,
    nickname: 'TestUser',
    isProSubscriber: false,
    proSubscriptionEndAt: null,
    isAmbassador: false,
  },
  customization: null,
  globalProfile: null,
  voiceCommission: null,
  homeworkSong: null,
};

describe('toChannelDetailDto — voiceCommissionActive / homeworkSongActive', () => {
  it('voiceCommission.isActive=true 이면 voiceCommissionActive=true 를 반환해야 함', () => {
    const channel = {
      ...baseDetailChannel,
      voiceCommission: { isActive: true },
    };
    const result = toChannelDetailDto(channel as any);
    expect(result.voiceCommissionActive).toBe(true);
  });

  it('voiceCommission 레코드가 없으면 voiceCommissionActive=false 를 반환해야 함', () => {
    const channel = {
      ...baseDetailChannel,
      voiceCommission: null,
    };
    const result = toChannelDetailDto(channel as any);
    expect(result.voiceCommissionActive).toBe(false);
  });

  it('voiceCommission.isActive=false 이면 voiceCommissionActive=false 를 반환해야 함', () => {
    const channel = {
      ...baseDetailChannel,
      voiceCommission: { isActive: false },
    };
    const result = toChannelDetailDto(channel as any);
    expect(result.voiceCommissionActive).toBe(false);
  });

  it('homeworkSong.isActive=true 이면 homeworkSongActive=true 를 반환해야 함', () => {
    const channel = {
      ...baseDetailChannel,
      homeworkSong: { isActive: true },
    };
    const result = toChannelDetailDto(channel as any);
    expect(result.homeworkSongActive).toBe(true);
  });

  it('homeworkSong 레코드가 없으면 homeworkSongActive=false 를 반환해야 함', () => {
    const channel = {
      ...baseDetailChannel,
      homeworkSong: null,
    };
    const result = toChannelDetailDto(channel as any);
    expect(result.homeworkSongActive).toBe(false);
  });

  it('homeworkSong.isActive=false 이면 homeworkSongActive=false 를 반환해야 함', () => {
    const channel = {
      ...baseDetailChannel,
      homeworkSong: { isActive: false },
    };
    const result = toChannelDetailDto(channel as any);
    expect(result.homeworkSongActive).toBe(false);
  });

  it('voiceCommission.isActive=true && homeworkSong.isActive=true 이면 둘 다 true', () => {
    const channel = {
      ...baseDetailChannel,
      voiceCommission: { isActive: true },
      homeworkSong: { isActive: true },
    };
    const result = toChannelDetailDto(channel as any);
    expect(result.voiceCommissionActive).toBe(true);
    expect(result.homeworkSongActive).toBe(true);
  });
});
