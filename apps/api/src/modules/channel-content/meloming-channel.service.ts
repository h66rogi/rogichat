import { Inject, Injectable } from '@nestjs/common';
import { Transactions } from '../../infrastructure/database/transactions.js';
import type { CommandCredentials, SessionCredentials } from '../auth/auth-context.js';
import { AuthService } from '../auth/auth.service.js';
import { ApiError } from '../auth/auth-primitives.js';
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

const editableFeatureKeys = ['musicbook', 'schedule', 'setlist', 'wardrobe'] as const;
type EditableFeatureKey = typeof editableFeatureKeys[number];
type EditableFeature = { key: EditableFeatureKey; label: string; isEnabled: boolean; order: number };

function parseFeatureSettings(value: unknown): EditableFeature[] {
  if (!value || typeof value !== 'object' || Array.isArray(value) ||
    Object.keys(value).length !== 1 || !Object.hasOwn(value, 'items')) throw new ApiError('INVALID_REQUEST', 400);
  const items = (value as { items: unknown }).items;
  if (!Array.isArray(items) || items.length !== editableFeatureKeys.length) throw new ApiError('INVALID_REQUEST', 400);
  const keys = new Set<string>();
  const orders = new Set<number>();
  const parsed = items.map((item: unknown) => {
    if (!item || typeof item !== 'object' || Array.isArray(item)) throw new ApiError('INVALID_REQUEST', 400);
    const raw = item as Record<string, unknown>;
    if (Object.keys(raw).some(key => !['key', 'label', 'isEnabled', 'order'].includes(key)) ||
      !editableFeatureKeys.includes(raw.key as EditableFeatureKey) ||
      typeof raw.label !== 'string' || !raw.label.trim() || raw.label.trim().length > 24 ||
      typeof raw.isEnabled !== 'boolean' || !Number.isInteger(raw.order) ||
      (raw.order as number) < 0 || (raw.order as number) >= editableFeatureKeys.length) throw new ApiError('INVALID_REQUEST', 400);
    const key = raw.key as EditableFeatureKey;
    const order = raw.order as number;
    if (keys.has(key) || orders.has(order)) throw new ApiError('INVALID_REQUEST', 400);
    keys.add(key); orders.add(order);
    return { key, label: raw.label.trim(), isEnabled: raw.isEnabled, order };
  });
  return parsed.sort((a, b) => a.order - b.order);
}

@Injectable()
export class MelomingChannelService {
  constructor(
    @Inject(Transactions) private readonly transactions: Transactions,
    @Inject(AuthService) private readonly auth: AuthService,
    @Inject(ChannelContentRepository) private readonly repository: ChannelContentRepository,
  ) {}

  detail() {
    return this.transactions.read(async tx => {
      const { roomId, ownerId } = await this.repository.primary(tx);
      const room = await tx.prisma.rooms.findUniqueOrThrow({ where: { id: roomId }, select: { name: true, created_at: true, schedule_notice: true } });
      const soop=ownerId?await tx.prisma.platform_soop.findUnique({where:{user_id:ownerId},
        select:{status:true,provider_subject:true}}):null;
      const soopId=soop?.status==='VERIFIED'?Buffer.from(soop.provider_subject).toString('utf8'):null;
      const [songs, artists, categories] = await Promise.all([
        tx.prisma.song.count({ where: { channelId: roomId } }),
        tx.prisma.artist.count({ where: { channelId: roomId } }),
        tx.prisma.category.count({ where: { channelId: roomId } }),
      ]);
      return {
        id: publicChannelId, name: room.name, webPath: 'hurogi',
        platformUrl: soopId?`https://www.sooplive.co.kr/station/${encodeURIComponent(soopId)}`:null,
        profileImageUrl: '/images/hurogi-profile.png', topBannerUrl: null,
        leftBannerUrl: null, leftBannerLink: null, rightBannerUrl: null,
        rightBannerLink: null, additionalLinks: [], themeColor: '#ff8c9d',
        channelDescription: '', createdAt: room.created_at.toISOString(),
        updatedAt: room.created_at.toISOString(), _count: { songs, artists, categories },
        layoutType: 'new', visibility: 'PUBLIC', scheduleNotice: room.schedule_notice,
        isOwnerProSubscriber: false, isOwnerAmbassador: false, isFounder: false,
        isVerified: Boolean(soopId), verifications: soopId?[{platform:'SOOP',platformChannelId:soopId}]:[],
      };
    });
  }

  async updateScheduleNotice(credentials: CommandCredentials, value: unknown) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw new ApiError('INVALID_REQUEST', 400);
    const raw = value as Record<string, unknown>;
    if (Object.keys(raw).length !== 1 || !Object.hasOwn(raw, 'scheduleNotice') ||
      (raw.scheduleNotice !== null && (typeof raw.scheduleNotice !== 'string' || raw.scheduleNotice.length > 65535))) {
      throw new ApiError('INVALID_REQUEST', 400);
    }
    await this.transactions.write(async tx => {
      const actor = await this.auth.require(tx, credentials, true);
      const roomId = await this.repository.requireOwner(tx, actor.userId);
      await tx.prisma.rooms.update({ where: { id: roomId }, data: { schedule_notice: raw.scheduleNotice as string | null } });
    });
    return this.detail();
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
      const { roomId } = await this.repository.primary(tx);
      const saved = await tx.prisma.channelFeatureSettings.findUnique({ where: { channelId: roomId }, select: { items: true } });
      if (!saved) return featureSettings;
      const overrides = new Map((saved.items as EditableFeature[]).map(item => [item.key, item]));
      return { items: featureSettings.items.map(defaultItem => {
        const savedItem = overrides.get(defaultItem.key as EditableFeatureKey);
        return savedItem ? { ...defaultItem, label: savedItem.label, isEnabled: savedItem.isEnabled, order: savedItem.order } : defaultItem;
      }) };
    });
  }

  async updateFeatureSettings(credentials: CommandCredentials, value: unknown) {
    const items = parseFeatureSettings(value);
    await this.transactions.write(async tx => {
      const actor = await this.auth.require(tx, credentials, true);
      const roomId = await this.repository.requireOwner(tx, actor.userId);
      await tx.prisma.channelFeatureSettings.upsert({ where: { channelId: roomId }, create: { channelId: roomId, items }, update: { items } });
    });
    return this.features();
  }
}
