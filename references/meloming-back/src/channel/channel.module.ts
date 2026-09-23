import { Module } from '@nestjs/common';
import { ChannelService } from './channel.service';
import { ChannelController } from './channel.controller';
import { ChannelListController } from './channel-list.controller';
import { ChannelTransferController } from './channel-transfer.controller';
import { PrismaModule } from '../prisma/prisma.module';
import { ChannelPermissionGuard } from './guards/channel-permission.guard';
import { ChannelOwnershipGuard } from './guards/channel-ownership.guard';
import { PointsModule } from '../points/points.module';
import { TransactionalEmailModule } from '../transactional-email/transactional-email.module';
import { DistributedLockModule } from '../common/distributed-lock/distributed-lock.module';
import { ChannelTransferService } from './channel-transfer.service';
import { ChannelProfileService } from './channel-profile.service';
import { ChannelProfileController } from './channel-profile.controller';
import { ChannelGlobalProfileService } from './channel-global-profile.service';
import { ChannelGlobalProfileController } from './channel-global-profile.controller';
import { ChannelClipSettingsService } from './channel-clip-settings.service';
import { ChannelClipSettingsController } from './channel-clip-settings.controller';
import { ChannelFeatureSettingsController } from './channel-feature-settings.controller';
import { ChannelFeatureSettingsService } from './channel-feature-settings.service';
import { ChannelWardrobeController } from './channel-wardrobe.controller';
import { ChannelWardrobeService } from './channel-wardrobe.service';
import { ChannelSongRequestSettingsService } from './channel-song-request-settings.service';
import { ChannelSongRequestSettingsController } from './channel-song-request-settings.controller';
import { ChannelSongRequestSettingsNotifierService } from './channel-song-request-settings-notifier.service';
import { ChannelMusicbookSettingsController } from './channel-musicbook-settings.controller';
import { ChannelMusicbookSettingsService } from './channel-musicbook-settings.service';
import { ChannelAnniversaryHighlightsController } from './channel-anniversary-highlights.controller';
import { ChannelAnniversaryHighlightsService } from './channel-anniversary-highlights.service';
import { ChannelCustomizationController } from './customization/channel-customization.controller';
import { ChannelCustomizationService } from './customization/channel-customization.service';
import { CssValidatorService } from './customization/css-validator.service';
import { CustomizationExpiryService } from './customization/customization-expiry.service';
import { ChannelManagerController } from './channel-manager.controller';
import { ChannelManagerService } from './channel-manager.service';
import { OverlayWidgetCustomizationController } from './overlay-customization/overlay-widget-customization.controller';
import { OverlayWidgetCustomizationService } from './overlay-customization/overlay-widget-customization.service';
import { AdminChannelUserLookupController } from './admin/admin-channel-user-lookup.controller';
import { AdminChannelController } from './admin/admin-channel.controller';
import { AdminChannelService } from './admin/admin-channel.service';
import { InternalChannelMembershipController } from './internal-channel-membership.controller';
import { SongRequestOverlayFeatureGuard } from '../common/guards/song-request-overlay-feature.guard';
import { SoftconeModule } from '../softcone/softcone.module';
import { NotificationsModule } from '../notifications/notifications.module';
import { AdminUserAccessGuard } from '../user/admin/admin-user-access.guard';
import { TalkV2Module } from '../talk-v2/talk-v2.module';
import { ReferralModule } from '../referral/referral.module';
import { ChannelMembershipModule } from '../channel-membership/channel-membership.module';
import { ChannelMembershipSettingsController } from './channel-membership-settings.controller';

@Module({
  imports: [
    PrismaModule,
    PointsModule,
    TransactionalEmailModule,
    DistributedLockModule,
    SoftconeModule,
    NotificationsModule,
    TalkV2Module,
    ReferralModule,
    ChannelMembershipModule,
  ],
  controllers: [
    ChannelController,
    ChannelListController,
    ChannelTransferController,
    ChannelProfileController,
    ChannelGlobalProfileController,
    ChannelClipSettingsController,
    ChannelFeatureSettingsController,
    ChannelWardrobeController,
    ChannelSongRequestSettingsController,
    ChannelMusicbookSettingsController,
    ChannelAnniversaryHighlightsController,
    ChannelCustomizationController,
    ChannelManagerController,
    OverlayWidgetCustomizationController,
    AdminChannelController,
    AdminChannelUserLookupController,
    InternalChannelMembershipController,
    ChannelMembershipSettingsController,
  ],
  providers: [
    ChannelService,
    AdminChannelService,
    ChannelTransferService,
    ChannelPermissionGuard,
    SongRequestOverlayFeatureGuard,
    ChannelOwnershipGuard,
    AdminUserAccessGuard,
    ChannelProfileService,
    ChannelGlobalProfileService,
    ChannelClipSettingsService,
    ChannelFeatureSettingsService,
    ChannelWardrobeService,
    ChannelSongRequestSettingsService,
    ChannelSongRequestSettingsNotifierService,
    ChannelMusicbookSettingsService,
    ChannelAnniversaryHighlightsService,
    ChannelCustomizationService,
    CssValidatorService,
    CustomizationExpiryService,
    ChannelManagerService,
    OverlayWidgetCustomizationService,
  ],
  exports: [
    ChannelService,
    ChannelTransferService,
    ChannelPermissionGuard,
    SongRequestOverlayFeatureGuard,
    ChannelOwnershipGuard,
    ChannelManagerService,
    ChannelFeatureSettingsService,
    ChannelWardrobeService,
    ChannelSongRequestSettingsService,
    ChannelSongRequestSettingsNotifierService,
    ChannelMusicbookSettingsService,
  ],
})
export class ChannelModule {}
