import { Inject, Injectable } from '@nestjs/common';
import { Transactions } from '../../infrastructure/database/transactions.js';
import type { SessionCredentials } from '../auth/auth-context.js';
import { AuthService } from '../auth/auth.service.js';
import { ChannelContentRepository } from './channel-content.repository.js';

// Meloming's public channel contract uses an integer id. Rogichat has exactly
// one channel; this stable public alias is resolved to its real bound room in
// every query. The room UUID and provider identity stay private.
const publicChannelId = 1;

const featureSettings = {
  items: [
    { key: 'home', label: '홈', defaultLabel: '홈', isEnabled: false, order: 0 },
    { key: 'musicbook', label: '노래책', defaultLabel: '노래책', isEnabled: true, order: 1 },
    { key: 'schedule', label: '캘린더', defaultLabel: '캘린더', isEnabled: true, order: 2 },
    { key: 'content', label: '콘텐츠', defaultLabel: '콘텐츠', isEnabled: false, order: 3 },
    { key: 'setlist', label: '셋리스트', defaultLabel: '셋리스트', isEnabled: true, order: 4 },
    { key: 'guestbook', label: '방명록', defaultLabel: '방명록', isEnabled: false, order: 5 },
    { key: 'wardrobe', label: '옷장', defaultLabel: '옷장', isEnabled: true, order: 6 },
    { key: 'info', label: '정보', defaultLabel: '정보', isEnabled: false, order: 7 },
  ],
};

@Injectable()
export class MelomingChannelService {
  constructor(
    @Inject(Transactions) private readonly transactions: Transactions,
    @Inject(AuthService) private readonly auth: AuthService,
    @Inject(ChannelContentRepository) private readonly repository: ChannelContentRepository,
  ) {}

  detail() {
    return this.transactions.read(async tx => {
      const { roomId } = await this.repository.primary(tx);
      const room = await tx.prisma.rooms.findUniqueOrThrow({ where: { id: roomId }, select: { name: true, created_at: true } });
      const [songs, artists, categories] = await Promise.all([
        tx.prisma.song.count({ where: { channelId: roomId } }),
        tx.prisma.artist.count({ where: { channelId: roomId } }),
        tx.prisma.category.count({ where: { channelId: roomId } }),
      ]);
      return {
        id: publicChannelId, name: room.name, webPath: 'hurogi', platformUrl: null,
        profileImageUrl: '/images/hurogi-profile.png', topBannerUrl: null,
        leftBannerUrl: null, leftBannerLink: null, rightBannerUrl: null,
        rightBannerLink: null, additionalLinks: [], themeColor: '#ff8c9d',
        channelDescription: '', createdAt: room.created_at.toISOString(),
        updatedAt: room.created_at.toISOString(), _count: { songs, artists, categories },
        layoutType: 'new', visibility: 'PUBLIC', scheduleNotice: null,
        isOwnerProSubscriber: false, isOwnerAmbassador: false, isFounder: false,
        isVerified: false, verifications: [],
      };
    });
  }

  permission(credentials: SessionCredentials) {
    return this.transactions.read(async tx => {
      const actor = await this.auth.require(tx, credentials, true);
      const channel = await this.repository.primary(tx);
      const owner = channel.ownerId === actor.userId;
      if (owner) await this.repository.requireOwner(tx, actor.userId);
      return {
        view: true, manageContent: owner, manageSettings: owner,
        manageProfile: owner, manageGuestbook: false,
        manageCustomization: false, manageEmoticons: false,
        isOwner: owner, isOwnerProSubscriber: false,
      };
    });
  }

  features() {
    return this.transactions.read(async tx => {
      await this.repository.primary(tx);
      return featureSettings;
    });
  }
}
