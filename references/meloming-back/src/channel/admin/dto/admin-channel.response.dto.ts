import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  ChannelColorMode,
  ChannelHeaderStyle,
  ChannelLayoutWidth,
  ChannelTransferStatus,
  ChannelVerificationPendingReason,
  ChannelVerificationStatus,
  ChannelVisibility,
  KaraokePlaybackMode,
  KaraokeVideoType,
  LiveSessionStatus,
  ScheduleVisibility,
  SongRequestMode,
  StreamPlatform,
} from '@prisma/client';

export class AdminChannelOwnerDto {
  @ApiProperty() id!: number;
  @ApiProperty() email!: string;
  @ApiPropertyOptional({ nullable: true }) nickname?: string | null;
  @ApiPropertyOptional({ nullable: true }) profileImageUrl?: string | null;
  @ApiProperty() isActive!: boolean;
  @ApiProperty() isDeleted!: boolean;
  @ApiProperty() isProSubscriber!: boolean;
  @ApiPropertyOptional({ type: String, format: 'date-time', nullable: true })
  proSubscriptionEndAt?: Date | null;
  @ApiProperty() isAmbassador!: boolean;
}

export class AdminChannelCountsDto {
  @ApiProperty() songs!: number;
  @ApiProperty() categories!: number;
  @ApiProperty() artists!: number;
  @ApiProperty() managers!: number;
  @ApiProperty() favorites!: number;
  @ApiProperty() verifications!: number;
  @ApiProperty() liveSessions!: number;
  @ApiProperty() emoticons!: number;
  @ApiProperty() schedules!: number;
  @ApiProperty() playlists!: number;
  @ApiProperty() clips!: number;
}

export class AdminChannelVerificationSummaryDto {
  @ApiProperty() id!: number;
  @ApiProperty({ enum: StreamPlatform }) platform!: StreamPlatform;
  @ApiPropertyOptional({ nullable: true }) platformChannelId?: string | null;
  @ApiProperty({ enum: ChannelVerificationStatus })
  status!: ChannelVerificationStatus;
  @ApiPropertyOptional({
    enum: ChannelVerificationPendingReason,
    nullable: true,
  })
  pendingReason?: ChannelVerificationPendingReason | null;
  @ApiProperty({ type: String, format: 'date-time' }) createdAt!: Date;
  @ApiPropertyOptional({ type: String, format: 'date-time', nullable: true })
  reviewedAt?: Date | null;
}

export class AdminChannelGlobalProfileDto {
  @ApiProperty() globalEnabled!: boolean;
  @ApiPropertyOptional({ nullable: true }) globalName?: string | null;
  @ApiPropertyOptional({ nullable: true }) globalDescription?: string | null;
  @ApiPropertyOptional({ nullable: true }) globalProfileImageUrl?:
    | string
    | null;
  @ApiPropertyOptional({ nullable: true }) primaryLocale?: string | null;
}

export class AdminChannelCustomizationDto {
  @ApiProperty() isEnabled!: boolean;
  @ApiProperty({ enum: ChannelColorMode }) forcedColorMode!: ChannelColorMode;
  @ApiProperty({ enum: ChannelLayoutWidth }) layoutWidth!: ChannelLayoutWidth;
  @ApiProperty({ enum: ChannelHeaderStyle }) headerStyle!: ChannelHeaderStyle;
}

export class AdminChannelSongRequestSettingsDto {
  @ApiProperty() requestCommand!: string;
  @ApiProperty() maxQueueSize!: number;
  @ApiProperty() donationPriorityEnabled!: boolean;
  @ApiProperty() enforceDonationMinimumPrice!: boolean;
  @ApiProperty({ enum: KaraokePlaybackMode })
  karaokePlaybackMode!: KaraokePlaybackMode;
  @ApiProperty({ enum: KaraokeVideoType })
  karaokeVideoType!: KaraokeVideoType;
  @ApiProperty() donationOnlyEnabled!: boolean;
  @ApiProperty({ enum: SongRequestMode }) requestMode!: SongRequestMode;
  @ApiProperty() chatRequestEnabled!: boolean;
  @ApiProperty() donationRequestEnabled!: boolean;
  @ApiProperty() allowAnonymous!: boolean;
  @ApiProperty() requireSongMatch!: boolean;
  @ApiProperty() randomRequestEnabled!: boolean;
  @ApiProperty() preventDuplicateSongs!: boolean;
  @ApiProperty() maxRequestsPerUser!: number;
  @ApiProperty() maxTotalRequests!: number;
  @ApiProperty() showRequesterName!: boolean;
  @ApiProperty({ type: String, format: 'date-time' }) updatedAt!: Date;
}

export class AdminChannelClipSettingsDto {
  @ApiProperty() autoClipEnabled!: boolean;
  @ApiProperty({ type: String, format: 'date-time' }) updatedAt!: Date;
}

export class AdminChannelPricingSettingsDto {
  @ApiPropertyOptional({ nullable: true }) defaultPrice?: number | null;
  @ApiPropertyOptional({ nullable: true }) difficultyPrices?: unknown;
  @ApiProperty() pricingEnabled!: boolean;
  @ApiProperty({ type: String, format: 'date-time' }) updatedAt!: Date;
}

export class AdminChannelLiveSessionDto {
  @ApiProperty() id!: number;
  @ApiProperty({ enum: LiveSessionStatus }) status!: LiveSessionStatus;
  @ApiPropertyOptional({ enum: StreamPlatform, nullable: true })
  platform?: StreamPlatform | null;
  @ApiPropertyOptional({ nullable: true }) platformChannelId?: string | null;
  @ApiProperty({ enum: ScheduleVisibility }) visibility!: ScheduleVisibility;
  @ApiProperty({ type: String, format: 'date-time' }) startedAt!: Date;
  @ApiPropertyOptional({ type: String, format: 'date-time', nullable: true })
  endedAt?: Date | null;
  @ApiProperty() songRequestCount!: number;
}

export class AdminChannelManagerDto {
  @ApiProperty() id!: number;
  @ApiProperty() userId!: number;
  @ApiProperty() canManageContent!: boolean;
  @ApiProperty() canManageSettings!: boolean;
  @ApiProperty() canManageProfile!: boolean;
  @ApiProperty() canManageGuestbook!: boolean;
  @ApiProperty() canManageCustomization!: boolean;
  @ApiProperty() canManageEmoticons!: boolean;
  @ApiProperty() isActive!: boolean;
  @ApiPropertyOptional({ nullable: true }) grantedByUserId?: number | null;
  @ApiPropertyOptional({ type: String, format: 'date-time', nullable: true })
  createdAt?: Date | null;
  @ApiPropertyOptional({ type: String, format: 'date-time', nullable: true })
  revokedAt?: Date | null;
  @ApiProperty()
  user!: { id: number; email: string; nickname: string | null };
  @ApiPropertyOptional({ nullable: true })
  grantedByUser?: { id: number; email: string; nickname: string | null } | null;
}

export class AdminChannelTransferRequestDto {
  @ApiProperty() id!: number;
  @ApiProperty({ enum: ChannelTransferStatus }) status!: ChannelTransferStatus;
  @ApiProperty() currentOwnerUserId!: number;
  @ApiPropertyOptional({ nullable: true }) targetUserId?: number | null;
  @ApiProperty() targetEmail!: string;
  @ApiPropertyOptional({ nullable: true }) rejectReason?: string | null;
  @ApiPropertyOptional({ type: String, format: 'date-time', nullable: true })
  reviewedAt?: Date | null;
  @ApiPropertyOptional({ type: String, format: 'date-time', nullable: true })
  createdAt?: Date | null;
  @ApiPropertyOptional({ nullable: true })
  targetUser?: { id: number; email: string; nickname: string | null } | null;
}

export class AdminChannelExternalBindingDto {
  @ApiProperty()
  youtubeChannels!: Array<{
    id: number;
    youtubeChannelId: string;
    channelTitle: string;
    customUrl: string | null;
    subscriberCount: number;
    streamRecognitionEnabled: boolean;
    clipMatchingPrimary: boolean;
    isActive: boolean;
    lastSyncedAt: Date | null;
    lastErrorAt: Date | null;
    lastErrorCode: string | null;
  }>;
}

export class AdminChannelListItemDto {
  @ApiProperty() id!: number;
  @ApiProperty() userId!: number;
  @ApiProperty() name!: string;
  @ApiProperty() webPath!: string;
  @ApiPropertyOptional({ nullable: true }) platformUrl?: string | null;
  @ApiPropertyOptional({ nullable: true }) profileImageUrl?: string | null;
  @ApiPropertyOptional({ nullable: true }) themeColor?: string | null;
  @ApiProperty({ enum: ChannelVisibility }) visibility!: ChannelVisibility;
  @ApiPropertyOptional({ nullable: true }) channelDescription?: string | null;
  @ApiPropertyOptional({ type: String, format: 'date-time', nullable: true })
  createdAt?: Date | null;
  @ApiPropertyOptional({ type: String, format: 'date-time', nullable: true })
  updatedAt?: Date | null;
  @ApiProperty({ type: AdminChannelOwnerDto }) owner!: AdminChannelOwnerDto;
  @ApiProperty({ type: AdminChannelCountsDto }) counts!: AdminChannelCountsDto;
  @ApiProperty({ type: AdminChannelVerificationSummaryDto, isArray: true })
  verifications!: AdminChannelVerificationSummaryDto[];
  @ApiPropertyOptional({ type: AdminChannelGlobalProfileDto, nullable: true })
  globalProfile?: AdminChannelGlobalProfileDto | null;
  @ApiPropertyOptional({ type: AdminChannelCustomizationDto, nullable: true })
  customization?: AdminChannelCustomizationDto | null;
  @ApiPropertyOptional({
    type: AdminChannelSongRequestSettingsDto,
    nullable: true,
  })
  songRequestSettings?: AdminChannelSongRequestSettingsDto | null;
  @ApiPropertyOptional({ type: AdminChannelLiveSessionDto, nullable: true })
  latestLiveSession?: AdminChannelLiveSessionDto | null;
}

export class AdminChannelListResponseDto {
  @ApiProperty() total!: number;
  @ApiProperty() page!: number;
  @ApiProperty() pageSize!: number;
  @ApiProperty({ type: AdminChannelListItemDto, isArray: true })
  items!: AdminChannelListItemDto[];
}

export class AdminChannelProfileDto {
  @ApiPropertyOptional({ type: String, format: 'date-time', nullable: true })
  birthday?: Date | null;
  @ApiPropertyOptional({ nullable: true }) residence?: string | null;
  @ApiPropertyOptional({ nullable: true }) heightCm?: string | null;
  @ApiPropertyOptional({ nullable: true }) weightKg?: string | null;
  @ApiPropertyOptional({ nullable: true }) nationality?: string | null;
  @ApiPropertyOptional({ nullable: true }) gender?: string | null;
  @ApiPropertyOptional({ nullable: true }) agency?: string | null;
  @ApiPropertyOptional({ nullable: true }) nickname?: string | null;
  @ApiPropertyOptional({ nullable: true }) fandomName?: string | null;
  @ApiPropertyOptional({ nullable: true }) mbti?: string | null;
  @ApiPropertyOptional({ type: String, format: 'date-time', nullable: true })
  debutDate?: Date | null;
  @ApiPropertyOptional({ nullable: true }) bio?: string | null;
  @ApiPropertyOptional({ nullable: true }) homeDescription?: string | null;
  @ApiPropertyOptional({ nullable: true }) links?: unknown;
  @ApiPropertyOptional({ nullable: true }) broadcastingPlatforms?: unknown;
}

export class AdminChannelDetailDto extends AdminChannelListItemDto {
  @ApiPropertyOptional({ nullable: true }) topBannerUrl?: string | null;
  @ApiPropertyOptional({ nullable: true }) leftBannerUrl?: string | null;
  @ApiPropertyOptional({ nullable: true }) leftBannerLink?: string | null;
  @ApiPropertyOptional({ nullable: true }) rightBannerUrl?: string | null;
  @ApiPropertyOptional({ nullable: true }) rightBannerLink?: string | null;
  @ApiPropertyOptional({ nullable: true }) scheduleNotice?: string | null;
  @ApiProperty() guestbookEnabled!: boolean;
  @ApiPropertyOptional({ nullable: true }) additionalLinks?: unknown;
  @ApiPropertyOptional({ type: AdminChannelProfileDto, nullable: true })
  profile?: AdminChannelProfileDto | null;
  @ApiProperty({ type: AdminChannelManagerDto, isArray: true })
  managers!: AdminChannelManagerDto[];
  @ApiProperty({ type: AdminChannelLiveSessionDto, isArray: true })
  recentLiveSessions!: AdminChannelLiveSessionDto[];
  @ApiProperty({ type: AdminChannelTransferRequestDto, isArray: true })
  transferRequests!: AdminChannelTransferRequestDto[];
  @ApiPropertyOptional({ type: AdminChannelClipSettingsDto, nullable: true })
  clipSettings?: AdminChannelClipSettingsDto | null;
  @ApiPropertyOptional({ type: AdminChannelPricingSettingsDto, nullable: true })
  pricingSettings?: AdminChannelPricingSettingsDto | null;
  @ApiProperty({ type: AdminChannelExternalBindingDto })
  externalBindings!: AdminChannelExternalBindingDto;
}
