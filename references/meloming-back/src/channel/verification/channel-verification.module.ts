import { Module } from '@nestjs/common';
import { PrismaModule } from '../../prisma/prisma.module';
import { PlatformModule } from '../../platform/platform.module';
import { NotificationsModule } from '../../notifications/notifications.module';
import { SlackWebhookService } from '../../common/slack/slack-webhook.service';
import { AdminUserAccessGuard } from '../../user/admin/admin-user-access.guard';
import { ChannelVerificationService } from './channel-verification.service';
import { ChannelVerificationController } from './channel-verification.controller';
import { AdminChannelVerificationController } from './admin/admin-channel-verification.controller';

@Module({
  imports: [PrismaModule, PlatformModule, NotificationsModule],
  controllers: [
    ChannelVerificationController,
    AdminChannelVerificationController,
  ],
  providers: [
    ChannelVerificationService,
    SlackWebhookService,
    AdminUserAccessGuard,
  ],
  exports: [ChannelVerificationService],
})
export class ChannelVerificationModule {}
