import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsBoolean, IsInt, IsOptional } from 'class-validator';

// ==================== Request DTOs ====================

export class UpdateManagerActiveDto {
  @ApiProperty({ description: '활성화 여부' })
  @IsBoolean()
  isActive!: boolean;
}

export class UpdateManagerPermissionsDto {
  @ApiPropertyOptional({ description: '콘텐츠 관리 권한' })
  @IsOptional()
  @IsBoolean()
  canManageContent?: boolean;

  @ApiPropertyOptional({ description: '설정 관리 권한' })
  @IsOptional()
  @IsBoolean()
  canManageSettings?: boolean;

  @ApiPropertyOptional({ description: '프로필 관리 권한' })
  @IsOptional()
  @IsBoolean()
  canManageProfile?: boolean;

  @ApiPropertyOptional({ description: '방명록 관리 권한' })
  @IsOptional()
  @IsBoolean()
  canManageGuestbook?: boolean;

  @ApiPropertyOptional({ description: '커스터마이징 관리 권한' })
  @IsOptional()
  @IsBoolean()
  canManageCustomization?: boolean;

  @ApiPropertyOptional({ description: '이모티콘 관리 권한' })
  @IsOptional()
  @IsBoolean()
  canManageEmoticons?: boolean;

  @ApiPropertyOptional({ description: '후여르 라이브 채팅 관리 권한' })
  @IsOptional()
  @IsBoolean()
  canManageHuyeorChat?: boolean;
}

export class AddManagerDto {
  @ApiProperty({ description: '매니저로 추가할 사용자 ID' })
  @IsInt()
  userId!: number;

  @ApiPropertyOptional({ description: '콘텐츠 관리 권한', default: false })
  @IsOptional()
  @IsBoolean()
  canManageContent?: boolean;

  @ApiPropertyOptional({ description: '설정 관리 권한', default: false })
  @IsOptional()
  @IsBoolean()
  canManageSettings?: boolean;

  @ApiPropertyOptional({ description: '프로필 관리 권한', default: false })
  @IsOptional()
  @IsBoolean()
  canManageProfile?: boolean;

  @ApiPropertyOptional({ description: '방명록 관리 권한', default: false })
  @IsOptional()
  @IsBoolean()
  canManageGuestbook?: boolean;

  @ApiPropertyOptional({
    description: '커스터마이징 관리 권한',
    default: false,
  })
  @IsOptional()
  @IsBoolean()
  canManageCustomization?: boolean;

  @ApiPropertyOptional({ description: '이모티콘 관리 권한', default: false })
  @IsOptional()
  @IsBoolean()
  canManageEmoticons?: boolean;

  @ApiPropertyOptional({ description: '후여르 라이브 채팅 관리 권한', default: false })
  @IsOptional()
  @IsBoolean()
  canManageHuyeorChat?: boolean;
}

// ==================== Response DTOs ====================

export class ManagerDto {
  @ApiProperty({ description: '매니저 ID' })
  id!: number;

  @ApiProperty({ description: '사용자 ID' })
  userId!: number;

  @ApiProperty({ description: '사용자 닉네임' })
  nickname!: string;

  @ApiPropertyOptional({ description: '사용자 프로필 이미지', nullable: true })
  profileImageUrl?: string | null;

  @ApiProperty({ description: '활성화 여부' })
  isActive!: boolean;

  @ApiProperty({ description: '콘텐츠 관리 권한' })
  canManageContent!: boolean;

  @ApiProperty({ description: '설정 관리 권한' })
  canManageSettings!: boolean;

  @ApiProperty({ description: '프로필 관리 권한' })
  canManageProfile!: boolean;

  @ApiProperty({ description: '방명록 관리 권한' })
  canManageGuestbook!: boolean;

  @ApiProperty({ description: '커스터마이징 관리 권한' })
  canManageCustomization!: boolean;

  @ApiProperty({ description: '이모티콘 관리 권한' })
  canManageEmoticons!: boolean;

  @ApiProperty({ description: '후여르 라이브 채팅 관리 권한' })
  canManageHuyeorChat!: boolean;

  @ApiProperty({ description: '등록일' })
  createdAt!: Date;

  @ApiPropertyOptional({ description: '비활성화일', nullable: true })
  revokedAt?: Date | null;
}

export class ManagerListResponseDto {
  @ApiProperty({ description: '매니저 목록', type: [ManagerDto] })
  managers!: ManagerDto[];

  @ApiProperty({
    description: '최대 활성 가능 매니저 수 (구독: 10, 비구독: 1)',
  })
  maxActiveManagers!: number;

  @ApiProperty({ description: '현재 활성 매니저 수' })
  activeManagerCount!: number;

  @ApiProperty({ description: '프로 구독 상태' })
  isProSubscriber!: boolean;
}

export class ToggleManagerActiveResponseDto {
  @ApiProperty({ description: '매니저 ID' })
  id!: number;

  @ApiProperty({ description: '활성화 여부' })
  isActive!: boolean;

  @ApiPropertyOptional({
    description: '비활성화된 기존 매니저 ID (비구독자가 다른 매니저 활성화 시)',
    nullable: true,
  })
  deactivatedManagerId?: number | null;
}
