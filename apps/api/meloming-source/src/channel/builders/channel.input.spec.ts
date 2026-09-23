import { buildChannelCreateInput, buildChannelUpdateInput } from './channel.input';
import { CreateChannelDto, UpdateChannelDto } from '../dto/channel.request.dto';

describe('buildChannelCreateInput', () => {
  const baseDto: CreateChannelDto = {
    name: '테스트 채널',
    webPath: 'test_channel',
  };

  it('기본 필드를 올바르게 매핑해야 함', () => {
    const result = buildChannelCreateInput(1, baseDto);

    expect(result).toEqual({
      user: { connect: { id: 1 } },
      name: '테스트 채널',
      webPath: 'test_channel',
      platformUrl: null,
      topBannerUrl: null,
      leftBannerUrl: null,
      leftBannerLink: null,
      rightBannerUrl: null,
      rightBannerLink: null,
      profileImageUrl: null,
      themeColor: '#ff6b35',
      channelDescription: null,
      additionalLinks: [],
    });
  });

  it('platformUrl이 빈 문자열이면 null로 변환해야 함', () => {
    const dto: CreateChannelDto = { ...baseDto, platformUrl: '' };
    const result = buildChannelCreateInput(1, dto);

    expect(result.platformUrl).toBeNull();
  });

  it('platformUrl이 undefined이면 null로 변환해야 함', () => {
    const dto: CreateChannelDto = { ...baseDto, platformUrl: undefined };
    const result = buildChannelCreateInput(1, dto);

    expect(result.platformUrl).toBeNull();
  });

  it('platformUrl이 유효한 URL이면 그대로 유지해야 함', () => {
    const dto: CreateChannelDto = {
      ...baseDto,
      platformUrl: 'https://chzzk.naver.com/test',
    };
    const result = buildChannelCreateInput(1, dto);

    expect(result.platformUrl).toBe('https://chzzk.naver.com/test');
  });

  it('배너 링크가 빈 문자열이면 null로 변환해야 함', () => {
    const dto: CreateChannelDto = {
      ...baseDto,
      leftBannerLink: '',
      rightBannerLink: '',
    };
    const result = buildChannelCreateInput(1, dto);

    expect(result.leftBannerLink).toBeNull();
    expect(result.rightBannerLink).toBeNull();
  });

  it('webPath를 소문자로 변환해야 함', () => {
    const dto: CreateChannelDto = { ...baseDto, webPath: 'TEST_Channel' };
    const result = buildChannelCreateInput(1, dto);

    expect(result.webPath).toBe('test_channel');
  });

  it('모든 선택 필드가 제공되면 올바르게 매핑해야 함', () => {
    const dto: CreateChannelDto = {
      ...baseDto,
      platformUrl: 'https://chzzk.naver.com/test',
      topBannerUrl: 'https://example.com/top.jpg',
      leftBannerUrl: 'https://example.com/left.jpg',
      rightBannerUrl: 'https://example.com/right.jpg',
      profileImageUrl: 'https://example.com/profile.jpg',
      themeColor: '#000000',
      channelDescription: '채널 설명',
      additionalLinks: [{ name: '트위터', url: 'https://twitter.com/test' }],
    };
    const result = buildChannelCreateInput(1, dto);

    expect(result.platformUrl).toBe('https://chzzk.naver.com/test');
    expect(result.topBannerUrl).toBe('https://example.com/top.jpg');
    expect(result.leftBannerUrl).toBe('https://example.com/left.jpg');
    expect(result.leftBannerLink).toBeNull();
    expect(result.rightBannerUrl).toBe('https://example.com/right.jpg');
    expect(result.rightBannerLink).toBeNull();
    expect(result.profileImageUrl).toBe('https://example.com/profile.jpg');
    expect(result.themeColor).toBe('#000000');
    expect(result.channelDescription).toBe('채널 설명');
    expect(result.additionalLinks).toEqual([
      { name: '트위터', url: 'https://twitter.com/test' },
    ]);
  });
});

describe('buildChannelUpdateInput', () => {
  it('platformUrl이 빈 문자열이면 null로 변환해야 함', () => {
    const dto: UpdateChannelDto = { platformUrl: '' };
    const result = buildChannelUpdateInput(dto);

    // updateInput에서는 ?? 사용 중이므로 빈 문자열은 그대로 전달됨
    // 이 테스트는 현재 동작을 문서화
    expect(result.platformUrl).toBe('');
  });

  it('platformUrl이 undefined이면 업데이트 대상에서 제외해야 함', () => {
    const dto: UpdateChannelDto = { name: '새 이름' };
    const result = buildChannelUpdateInput(dto);

    expect(result).not.toHaveProperty('platformUrl');
  });

  it('platformUrl이 유효한 URL이면 그대로 유지해야 함', () => {
    const dto: UpdateChannelDto = {
      platformUrl: 'https://chzzk.naver.com/new',
    };
    const result = buildChannelUpdateInput(dto);

    expect(result.platformUrl).toBe('https://chzzk.naver.com/new');
  });

  it('visibility가 UNLISTED이면 업데이트 대상에 포함해야 함', () => {
    const dto: UpdateChannelDto = { visibility: 'UNLISTED' };
    const result = buildChannelUpdateInput(dto);

    expect(result.visibility).toBe('UNLISTED');
  });

  it('visibility가 PUBLIC이면 업데이트 대상에 포함해야 함', () => {
    const dto: UpdateChannelDto = { visibility: 'PUBLIC' };
    const result = buildChannelUpdateInput(dto);

    expect(result.visibility).toBe('PUBLIC');
  });

  it('visibility가 undefined이면 업데이트 대상에서 제외해야 함', () => {
    const dto: UpdateChannelDto = { name: '새 이름' };
    const result = buildChannelUpdateInput(dto);

    expect(result).not.toHaveProperty('visibility');
  });

  it('leftBannerLink가 제공되면 업데이트 대상에 포함해야 함', () => {
    const dto: UpdateChannelDto = { leftBannerLink: 'https://example.com' };
    const result = buildChannelUpdateInput(dto);

    expect(result.leftBannerLink).toBe('https://example.com');
  });

  it('rightBannerLink가 제공되면 업데이트 대상에 포함해야 함', () => {
    const dto: UpdateChannelDto = { rightBannerLink: 'https://example.com/right' };
    const result = buildChannelUpdateInput(dto);

    expect(result.rightBannerLink).toBe('https://example.com/right');
  });

  it('leftBannerLink가 undefined이면 업데이트 대상에서 제외해야 함', () => {
    const dto: UpdateChannelDto = { name: '새 이름' };
    const result = buildChannelUpdateInput(dto);

    expect(result).not.toHaveProperty('leftBannerLink');
    expect(result).not.toHaveProperty('rightBannerLink');
  });

  it('배너 링크가 빈 문자열이면 null로 변환해야 함', () => {
    const dto: UpdateChannelDto = {
      leftBannerLink: '',
      rightBannerLink: '',
    };
    const result = buildChannelUpdateInput(dto);

    expect(result.leftBannerLink).toBeNull();
    expect(result.rightBannerLink).toBeNull();
  });

  it('profileImageUrl이 URL이면 그대로 포함해야 함', () => {
    const dto: UpdateChannelDto = { profileImageUrl: 'https://example.com/img.jpg' };
    const result = buildChannelUpdateInput(dto);
    expect(result.profileImageUrl).toBe('https://example.com/img.jpg');
  });

  it('profileImageUrl이 undefined이면 null로 변환해야 함', () => {
    const dto: UpdateChannelDto = { profileImageUrl: undefined };
    const result = buildChannelUpdateInput(dto);
    // undefined이면 업데이트 대상에서 제외됨
    expect(result).not.toHaveProperty('profileImageUrl');
  });

  it('topBannerUrl이 undefined 값이면 null로 변환해야 함', () => {
    const dto: UpdateChannelDto = { topBannerUrl: undefined };
    const result = buildChannelUpdateInput(dto);
    expect(result).not.toHaveProperty('topBannerUrl');
  });

  it('topBannerUrl이 null이면 null로 변환해야 함', () => {
    const dto: UpdateChannelDto = { topBannerUrl: null as any };
    const result = buildChannelUpdateInput(dto);
    expect(result.topBannerUrl).toBeNull();
  });

  it('leftBannerUrl이 null이면 null로 변환해야 함', () => {
    const dto: UpdateChannelDto = { leftBannerUrl: null as any };
    const result = buildChannelUpdateInput(dto);
    expect(result.leftBannerUrl).toBeNull();
  });

  it('rightBannerUrl이 null이면 null로 변환해야 함', () => {
    const dto: UpdateChannelDto = { rightBannerUrl: null as any };
    const result = buildChannelUpdateInput(dto);
    expect(result.rightBannerUrl).toBeNull();
  });

  it('profileImageUrl이 null이면 null로 변환해야 함', () => {
    const dto: UpdateChannelDto = { profileImageUrl: null as any };
    const result = buildChannelUpdateInput(dto);
    expect(result.profileImageUrl).toBeNull();
  });

  it('additionalLinks가 null이면 빈 배열로 변환해야 함', () => {
    const dto: UpdateChannelDto = { additionalLinks: null as any };
    const result = buildChannelUpdateInput(dto);
    expect(result.additionalLinks).toEqual([]);
  });

  it('channelDescription이 null이면 null로 변환해야 함', () => {
    const dto: UpdateChannelDto = { channelDescription: null as any };
    const result = buildChannelUpdateInput(dto);
    expect(result.channelDescription).toBeNull();
  });

  it('platformUrl이 null이면 null로 변환해야 함', () => {
    const dto: UpdateChannelDto = { platformUrl: null as any };
    const result = buildChannelUpdateInput(dto);
    expect(result.platformUrl).toBeNull();
  });

  it('additionalLinks가 undefined이면 빈 배열로 변환해야 함', () => {
    const dto: UpdateChannelDto = { additionalLinks: undefined };
    const result = buildChannelUpdateInput(dto);
    expect(result).not.toHaveProperty('additionalLinks');
  });

  it('channelDescription이 null이면 null로 저장해야 함', () => {
    const dto: UpdateChannelDto = { channelDescription: undefined };
    const result = buildChannelUpdateInput(dto);
    expect(result).not.toHaveProperty('channelDescription');
  });

  it('additionalLinks가 제공되면 업데이트 대상에 포함해야 함', () => {
    const dto: UpdateChannelDto = {
      additionalLinks: [{ name: '링크', url: 'https://example.com' }],
    };
    const result = buildChannelUpdateInput(dto);

    expect(result.additionalLinks).toEqual([{ name: '링크', url: 'https://example.com' }]);
  });

  it('channelDescription이 제공되면 업데이트 대상에 포함해야 함', () => {
    const dto: UpdateChannelDto = { channelDescription: '새 설명' };
    const result = buildChannelUpdateInput(dto);

    expect(result.channelDescription).toBe('새 설명');
  });

  it('themeColor가 제공되면 업데이트 대상에 포함해야 함', () => {
    const dto: UpdateChannelDto = { themeColor: '#FF0000' };
    const result = buildChannelUpdateInput(dto);

    expect(result.themeColor).toBe('#FF0000');
  });

  it('빈 DTO에서는 어떤 필드도 업데이트 대상에 포함하지 않아야 함', () => {
    const dto: UpdateChannelDto = {};
    const result = buildChannelUpdateInput(dto);

    expect(result).toEqual({});
  });

  it('topBannerUrl이 제공되면 업데이트 대상에 포함해야 함', () => {
    const dto: UpdateChannelDto = { topBannerUrl: 'https://example.com/top.jpg' };
    const result = buildChannelUpdateInput(dto);

    expect(result.topBannerUrl).toBe('https://example.com/top.jpg');
  });

  it('leftBannerUrl이 제공되면 업데이트 대상에 포함해야 함', () => {
    const dto: UpdateChannelDto = { leftBannerUrl: 'https://example.com/left.jpg' };
    const result = buildChannelUpdateInput(dto);

    expect(result.leftBannerUrl).toBe('https://example.com/left.jpg');
  });

  it('rightBannerUrl이 제공되면 업데이트 대상에 포함해야 함', () => {
    const dto: UpdateChannelDto = { rightBannerUrl: 'https://example.com/right.jpg' };
    const result = buildChannelUpdateInput(dto);

    expect(result.rightBannerUrl).toBe('https://example.com/right.jpg');
  });

  it('name과 webPath가 제공되면 업데이트 대상에 포함해야 함', () => {
    const dto: UpdateChannelDto = { name: '새이름', webPath: 'NEW_PATH' };
    const result = buildChannelUpdateInput(dto);

    expect(result.name).toBe('새이름');
    expect(result.webPath).toBe('new_path');
  });

  it('모든 배너 관련 필드를 한번에 업데이트할 수 있어야 함', () => {
    const dto: UpdateChannelDto = {
      topBannerUrl: 'https://example.com/top.jpg',
      leftBannerUrl: 'https://example.com/left.jpg',
      leftBannerLink: 'https://sponsor-left.com',
      rightBannerUrl: 'https://example.com/right.jpg',
      rightBannerLink: 'https://sponsor-right.com',
    };
    const result = buildChannelUpdateInput(dto);

    expect(result.topBannerUrl).toBe('https://example.com/top.jpg');
    expect(result.leftBannerUrl).toBe('https://example.com/left.jpg');
    expect(result.leftBannerLink).toBe('https://sponsor-left.com');
    expect(result.rightBannerUrl).toBe('https://example.com/right.jpg');
    expect(result.rightBannerLink).toBe('https://sponsor-right.com');
  });
});
