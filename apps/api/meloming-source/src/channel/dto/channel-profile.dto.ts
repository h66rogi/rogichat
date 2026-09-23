import { ApiProperty } from '@nestjs/swagger';
import {
  IsArray,
  IsDateString,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  Matches,
  Max,
  Min,
  ValidateNested,
  IsUrl,
} from 'class-validator';
import { Type } from 'class-transformer';

const MBTI_VALUES = [
  'ISTJ',
  'ISTP',
  'ISFJ',
  'ISFP',
  'INTJ',
  'INTP',
  'INFJ',
  'INFP',
  'ESTP',
  'ESTJ',
  'ESFP',
  'ESFJ',
  'ENTP',
  'ENTJ',
  'ENFP',
  'ENFJ',
] as const;

const PLATFORM_VALUES = ['SOOP', 'CHZZK', 'CIME', 'YOUTUBE', 'OTHER'] as const;

export class LinkDto {
  @ApiProperty({ example: 'YouTube', description: '링크 레이블' })
  @IsOptional()
  @IsString()
  label?: string;

  @ApiProperty({
    example: 'https://youtube.com/@melo',
    description: '유효한 URL',
  })
  @IsUrl()
  url!: string;

  @ApiProperty({
    required: false,
    example: 'youtube',
    description: '아이콘 키(선택)',
  })
  @IsOptional()
  @IsString()
  icon?: string;
}

export class ChannelProfileUpsertRequestDto {
  @ApiProperty({
    required: false,
    example: '2002-09-25',
    description:
      '생년월일. ISO 날짜 형식(YYYY-MM-DD 또는 ISO8601). 저장 시 Date로 변환됨.',
  })
  @IsOptional()
  @IsDateString()
  birthday?: string;

  @ApiProperty({
    required: false,
    example: 'Seoul, KR',
    description: '거주지 또는 활동 지역. 자유 텍스트.',
  })
  @IsOptional()
  @IsString()
  residence?: string;

  @ApiProperty({
    required: false,
    example: '178',
    description: '키(cm). 문자열로 입력.',
  })
  @IsOptional()
  @IsString()
  heightCm?: string;

  @ApiProperty({
    required: false,
    example: '72',
    description: '몸무게(kg). 문자열로 입력.',
  })
  @IsOptional()
  @IsString()
  weightKg?: string;

  @ApiProperty({
    required: false,
    example: 'KOR',
    description: '국적 코드 또는 국가명. 자유 텍스트(최대 100자 권장).',
  })
  @IsOptional()
  @IsString()
  nationality?: string;

  @ApiProperty({
    required: false,
    enum: ['MALE', 'FEMALE', 'NONBINARY', 'OTHER', 'SECRET'],
    example: 'MALE',
  })
  @IsOptional()
  @IsIn(['MALE', 'FEMALE', 'NONBINARY', 'OTHER', 'SECRET'])
  gender?: 'MALE' | 'FEMALE' | 'NONBINARY' | 'OTHER' | 'SECRET';

  @ApiProperty({
    required: false,
    description: '상징 색상. #RRGGBB 또는 #RRGGBBAA 형식 지원.',
    example: '#008080',
  })
  @IsOptional()
  @Matches(/^#?([A-Fa-f0-9]{6}|[A-Fa-f0-9]{8})$/)
  symbolColor?: string;

  @ApiProperty({
    required: false,
    example: 'DYLabs',
    description: '소속사/에이전시명.',
  })
  @IsOptional()
  @IsString()
  agency?: string;

  @ApiProperty({
    required: false,
    example: '초뜨',
    description: '활동명 또는 별칭.',
  })
  @IsOptional()
  @IsString()
  nickname?: string;

  @ApiProperty({
    required: false,
    example: '초뜨는 초뜨입니다.',
    description: '프로필 소개 요약 텍스트(홈 이외 화면에서 사용).',
  })
  @IsOptional()
  @IsString()
  description?: string;

  @ApiProperty({
    required: false,
    example: '홈 화면 상단 소개 문구입니다.',
    description: '채널 홈 화면 설명 (긴 문장 허용)',
  })
  @IsOptional()
  @IsString()
  homeDescription?: string;

  @ApiProperty({
    required: false,
    type: [String],
    example: ['멜로밍'],
    description: '소속/활동 그룹 목록.',
  })
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  affiliatedGroups?: string[];

  @ApiProperty({
    required: false,
    example: 'Melonians',
    description: '공식 팬덤명.',
  })
  @IsOptional()
  @IsString()
  fandomName?: string;

  @ApiProperty({
    required: false,
    example: 'None',
    description: '종교(선택).',
  })
  @IsOptional()
  @IsString()
  religion?: string;

  @ApiProperty({
    required: false,
    type: [String],
    example: ['Hanyang Cyber University (B.S.)'],
    description: '학력 목록(문자열 배열).',
  })
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  education?: string[];

  @ApiProperty({
    required: false,
    enum: MBTI_VALUES,
    example: 'ENTJ',
    description: 'MBTI(사전 정의된 값 중 선택).',
  })
  @IsOptional()
  @IsIn(MBTI_VALUES as unknown as string[])
  mbti?: (typeof MBTI_VALUES)[number];

  @ApiProperty({
    required: false,
    type: [String],
    example: ['퇴띵근', '초띵근'],
    description: '별명 목록(문자열 배열).',
  })
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  alias?: string[];

  @ApiProperty({
    required: false,
    example: '2022-02-22T00:00:00Z',
    description: '데뷔일(ISO8601). 저장 시 Date로 변환됨.',
  })
  @IsOptional()
  @IsDateString()
  debutDate?: string;

  @ApiProperty({
    required: false,
    type: [String],
    enum: PLATFORM_VALUES,
    example: ['CHZZK', 'YOUTUBE'],
    description: '활동 중인 방송 플랫폼 목록.',
  })
  @IsOptional()
  @IsArray()
  @IsIn(PLATFORM_VALUES as unknown as string[], { each: true })
  broadcastingPlatforms?: (typeof PLATFORM_VALUES)[number][];

  @ApiProperty({
    required: false,
    example: '스트리머/개발자. 음악과 코드 좋아합니다.',
    description: '자기소개(자유 서술).',
  })
  @IsOptional()
  @IsString()
  bio?: string;

  @ApiProperty({
    required: false,
    type: [LinkDto],
    example: [
      { label: 'YouTube', url: 'https://youtube.com/@melo', icon: 'youtube' },
    ],
    description: '외부 링크 목록. label/icon은 선택.',
  })
  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => LinkDto)
  links?: LinkDto[];
}

export class ChannelMilestonesDto {
  @ApiProperty({
    example: 365,
    description: '데뷔일로부터 경과한 일수 (데뷔 당일 = 1)',
  })
  daysPassed!: number;

  @ApiProperty({
    example: '1주년',
    description: '다음 기념일 라벨 (예: 100일, 200일, 1주년 등)',
  })
  nextMilestone!: string;

  @ApiProperty({
    example: 30,
    description: '다음 기념일까지 남은 일수',
  })
  daysToMilestone!: number;
}

export class ChannelBirthdayDdayDto {
  @ApiProperty({
    example: 10,
    description: '생일까지 남은 일수 (0이면 D-DAY)',
  })
  daysUntilBirthday!: number;

  @ApiProperty({
    example: '1월 1일',
    description: '생일 표시용 문자열',
  })
  birthdayDate!: string;
}

export class ChannelNextUpcomingEventDto {
  @ApiProperty({
    example: 'birthday',
    enum: ['broadcast', 'birthday'],
    description: '이벤트 타입 (방송 기념일 / 생일)',
  })
  type!: 'broadcast' | 'birthday';

  @ApiProperty({
    example: '생일 (1월 1일)',
    description: '이벤트 라벨 (예: 100일, 1주년, 생일 (1월 1일))',
  })
  label!: string;

  @ApiProperty({
    example: 3,
    description: '이벤트까지 남은 일수',
  })
  daysUntil!: number;
}

export class ChannelAnniversariesDto {
  @ApiProperty({
    required: false,
    type: ChannelMilestonesDto,
    nullable: true,
    description: '방송 데뷔일 기준 기념일 정보',
  })
  milestones?: ChannelMilestonesDto | null;

  @ApiProperty({
    required: false,
    type: ChannelBirthdayDdayDto,
    nullable: true,
    description: '생일 D-Day 정보',
  })
  birthday?: ChannelBirthdayDdayDto | null;

  @ApiProperty({
    required: false,
    type: ChannelNextUpcomingEventDto,
    nullable: true,
    description: '다가오는 기념일(방송/생일 중 더 가까운 것)',
  })
  nextUpcomingEvent?: ChannelNextUpcomingEventDto | null;
}

export class ChannelProfileResponseDto {
  @ApiProperty({ example: 123 })
  channelId!: number;

  @ApiProperty({ required: false, description: '생년월일(ISO8601)' })
  birthday?: string;
  @ApiProperty({ required: false, description: '거주지/활동 지역' })
  residence?: string;
  @ApiProperty({ required: false, description: '키(cm)' }) heightCm?: string;
  @ApiProperty({ required: false, description: '몸무게(kg)' })
  weightKg?: string;
  @ApiProperty({ required: false, description: '국적' }) nationality?: string;
  @ApiProperty({ required: false, description: '성별' }) gender?: string;
  @ApiProperty({ required: false, description: '상징 색상' })
  symbolColor?: string;
  @ApiProperty({ required: false, description: '소속사' }) agency?: string;
  @ApiProperty({
    required: false,
    type: [String],
    description: '소속/활동 그룹',
  })
  affiliatedGroups?: string[];
  @ApiProperty({ required: false, description: '팬덤명' }) fandomName?: string;
  @ApiProperty({ required: false, description: '종교' }) religion?: string;
  @ApiProperty({ required: false, description: '활동명/별칭' })
  nickname?: string;
  @ApiProperty({ required: false, description: '프로필 소개 요약' })
  description?: string;
  @ApiProperty({ required: false, description: '채널 홈 화면 설명' })
  homeDescription?: string;
  @ApiProperty({ required: false, type: [String], description: '학력' })
  education?: string[];
  @ApiProperty({ required: false, description: 'MBTI' }) mbti?: string;
  @ApiProperty({ required: false, type: [String], description: '별명 목록' })
  alias?: string[];
  @ApiProperty({ required: false, description: '데뷔일(ISO8601)' })
  debutDate?: string;
  @ApiProperty({
    required: false,
    type: [String],
    description: '활동 플랫폼 목록',
  })
  broadcastingPlatforms?: string[];
  @ApiProperty({ required: false, description: '자기소개' }) bio?: string;
  @ApiProperty({ required: false, type: [LinkDto], description: '외부 링크' })
  links?: LinkDto[];
  @ApiProperty({ required: false, description: '생성 시각(ISO8601)' })
  createdAt?: string;
  @ApiProperty({ required: false, description: '업데이트 시각(ISO8601)' })
  updatedAt?: string;

  @ApiProperty({
    required: false,
    type: ChannelAnniversariesDto,
    description:
      '채널 기념일 정보 요약(방송 데뷔일/생일 기반, KST 기준 계산 값)',
  })
  anniversaries?: ChannelAnniversariesDto;
}
