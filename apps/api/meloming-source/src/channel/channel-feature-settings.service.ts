import { randomUUID } from 'crypto';
import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import {
  CHANNEL_FEATURE_LAYOUT_TYPE,
  DEFAULT_CHANNEL_CUSTOM_MENU_ITEMS,
  DEFAULT_CHANNEL_FEATURE_SETTINGS,
  isChannelFeatureKey,
  type ChannelCustomMenuIconName,
  type ChannelCustomMenuItem,
  type ChannelCustomMenuItemType,
  type ChannelFeatureKey,
  type ChannelFeatureSetting,
} from './channel-feature-settings.constants';
import { UpdateChannelFeatureSettingsDto } from './dto/channel-feature-settings.dto';

type StoredFeatureLayout = {
  version?: number;
  items?: unknown;
  customItems?: unknown;
};

type StoredCustomPageComment = {
  id: string;
  userId: number;
  content: string;
  createdAt: string;
  updatedAt: string;
};

type ChannelCustomPageCommentResult = {
  id: string;
  content: string;
  author: {
    id: number;
    nickname: string;
    profileImageUrl: string | null;
  };
  createdAt: string;
  updatedAt: string;
  isEdited: boolean;
  canEdit: boolean;
  canDelete: boolean;
};

export interface ChannelCustomPageCommentsResult {
  commentsEnabled: boolean;
  items: ChannelCustomPageCommentResult[];
}

export interface ChannelFeatureSettingsResult {
  items: ChannelFeatureSetting[];
  customItems: ChannelCustomMenuItem[];
}

/**
 * 탭 식별자 rename 하위호환 — 저장된 layout 의 legacy key 를 현재 key 로 매핑한다.
 * 'homework' → 'homework-song' (노출 식별자 통일, 기존 저장 커스텀 라벨/숨김 보존).
 */
const LEGACY_FEATURE_KEY_MAP: Record<string, ChannelFeatureKey> = {
  homework: 'homework-song',
};

const CHANNEL_FEATURE_LAYOUT_VERSION = 3;
const CUSTOM_MENU_LABEL_MAX_LENGTH = 24;
const CUSTOM_MENU_CONTENT_MAX_LENGTH = 100_000;
const CUSTOM_PAGE_COMMENT_MAX_LENGTH = 1000;
const CUSTOM_PAGE_COMMENT_MAX_COUNT = 500;
const CUSTOM_MENU_RESERVED_PATHS = new Set([
  'manage',
  'live',
  ...DEFAULT_CHANNEL_FEATURE_SETTINGS.map((item) => item.key),
  'homework-song',
]);
const CUSTOM_MENU_ICON_NAME_PATTERN = /^[A-Z][A-Za-z0-9]{0,63}$/;

@Injectable()
export class ChannelFeatureSettingsService {
  constructor(private readonly prisma: PrismaService) {}

  async getSettings(channelId: number): Promise<ChannelFeatureSettingsResult> {
    const [stored, channel] = await Promise.all([
      this.prisma.channelOverlayLayout.findUnique({
        where: {
          channelId_layoutType: {
            channelId,
            layoutType: CHANNEL_FEATURE_LAYOUT_TYPE,
          },
        },
        select: { layout: true },
      }),
      this.prisma.channel.findUnique({
        where: { id: channelId },
        select: { guestbookEnabled: true },
      }),
    ]);

    const layout = stored?.layout as StoredFeatureLayout | undefined;
    const customItems = await this.normalizeCustomItems(
      channelId,
      layout?.customItems,
      {
        includeDefault:
          !layout || (layout.version ?? 0) < CHANNEL_FEATURE_LAYOUT_VERSION,
        preserveStoredOrder: layout?.version === CHANNEL_FEATURE_LAYOUT_VERSION,
      },
    );

    return {
      items: this.normalizeItems(layout?.items, channel?.guestbookEnabled, {
        preserveStoredOrder: layout?.version === CHANNEL_FEATURE_LAYOUT_VERSION,
      }),
      customItems,
    };
  }

  async updateSettings(
    channelId: number,
    dto: UpdateChannelFeatureSettingsDto,
  ): Promise<ChannelFeatureSettingsResult> {
    const existing = await this.prisma.channelOverlayLayout.findUnique({
      where: {
        channelId_layoutType: {
          channelId,
          layoutType: CHANNEL_FEATURE_LAYOUT_TYPE,
        },
      },
      select: { layout: true },
    });
    const existingLayout = existing?.layout as StoredFeatureLayout | undefined;
    const existingCommentsById = this.getStoredCustomPageCommentsById(
      existingLayout?.customItems,
    );
    const normalized = this.normalizeItems(dto.items, undefined, {
      preserveStoredOrder: true,
    });
    const customItems =
      dto.customItems === undefined
        ? await this.normalizeCustomItems(channelId, existingLayout?.customItems, {
            includeDefault:
              !existingLayout ||
              (existingLayout.version ?? 0) < CHANNEL_FEATURE_LAYOUT_VERSION,
            preserveStoredOrder:
              existingLayout?.version === CHANNEL_FEATURE_LAYOUT_VERSION,
          })
        : await this.normalizeCustomItems(channelId, dto.customItems, {
            includeDefault: false,
            validateBoardIds: true,
            preserveStoredOrder: true,
          });
    const layout = {
      version: CHANNEL_FEATURE_LAYOUT_VERSION,
      items: normalized.map(({ key, label, isEnabled, order }) => ({
        key,
        label,
        isEnabled,
        order,
      })),
      customItems: customItems.map((item) =>
        this.toStoredCustomMenuItem(
          item,
          item.type === 'page'
            ? (existingCommentsById.get(item.id) ?? [])
            : undefined,
        ),
      ),
    } satisfies Prisma.InputJsonObject;

    const saved = await this.prisma.$transaction(async (tx) => {
      const result = await tx.channelOverlayLayout.upsert({
        where: {
          channelId_layoutType: {
            channelId,
            layoutType: CHANNEL_FEATURE_LAYOUT_TYPE,
          },
        },
        update: { layout },
        create: {
          channelId,
          layoutType: CHANNEL_FEATURE_LAYOUT_TYPE,
          layout,
        },
        select: { layout: true },
      });

      const guestbook = normalized.find((item) => item.key === 'guestbook');
      if (guestbook) {
        await tx.channel.update({
          where: { id: channelId },
          data: { guestbookEnabled: guestbook.isEnabled },
        });
      }

      return result;
    });

    const savedLayout = saved.layout as StoredFeatureLayout | undefined;
    return {
      items: this.normalizeItems(savedLayout?.items, undefined, {
        preserveStoredOrder:
          savedLayout?.version === CHANNEL_FEATURE_LAYOUT_VERSION,
      }),
      customItems: await this.normalizeCustomItems(
        channelId,
        savedLayout?.customItems,
        {
          includeDefault: false,
          preserveStoredOrder:
            savedLayout?.version === CHANNEL_FEATURE_LAYOUT_VERSION,
        },
      ),
    };
  }

  async getCustomPageComments(
    channelId: number,
    pageId: string,
    currentUserId?: number,
  ): Promise<ChannelCustomPageCommentsResult> {
    const state = await this.getCustomPageCommentState(channelId, pageId);
    if (!state.page.commentsEnabled) {
      return { commentsEnabled: false, items: [] };
    }

    return {
      commentsEnabled: true,
      items: await this.toCustomPageCommentResults(
        channelId,
        state.comments,
        currentUserId,
      ),
    };
  }

  async createCustomPageComment(
    channelId: number,
    pageId: string,
    userId: number,
    content: string,
  ): Promise<ChannelCustomPageCommentResult> {
    const normalizedContent = this.normalizeCommentContent(content);
    const state = await this.getCustomPageCommentState(channelId, pageId);
    if (!state.page.commentsEnabled) {
      throw new BadRequestException('댓글이 비활성화된 페이지입니다.');
    }
    if (state.comments.length >= CUSTOM_PAGE_COMMENT_MAX_COUNT) {
      throw new BadRequestException(
        '댓글은 페이지당 최대 500개까지 작성할 수 있습니다.',
      );
    }

    const now = new Date().toISOString();
    const nextComment: StoredCustomPageComment = {
      id: randomUUID(),
      userId,
      content: normalizedContent,
      createdAt: now,
      updatedAt: now,
    };
    const comments = [...state.comments, nextComment];

    await this.saveCustomPageComments(channelId, state, comments);
    const [result] = await this.toCustomPageCommentResults(
      channelId,
      [nextComment],
      userId,
    );
    return result;
  }

  async updateCustomPageComment(
    channelId: number,
    pageId: string,
    commentId: string,
    userId: number,
    content: string,
  ): Promise<ChannelCustomPageCommentResult> {
    const normalizedContent = this.normalizeCommentContent(content);
    const state = await this.getCustomPageCommentState(channelId, pageId);
    if (!state.page.commentsEnabled) {
      throw new BadRequestException('댓글이 비활성화된 페이지입니다.');
    }

    const target = state.comments.find((comment) => comment.id === commentId);
    if (!target) {
      throw new NotFoundException('댓글을 찾을 수 없습니다.');
    }
    if (target.userId !== userId) {
      throw new ForbiddenException('댓글 작성자만 수정할 수 있습니다.');
    }

    const updated: StoredCustomPageComment = {
      ...target,
      content: normalizedContent,
      updatedAt: new Date().toISOString(),
    };
    const comments = state.comments.map((comment) =>
      comment.id === commentId ? updated : comment,
    );

    await this.saveCustomPageComments(channelId, state, comments);
    const [result] = await this.toCustomPageCommentResults(
      channelId,
      [updated],
      userId,
    );
    return result;
  }

  async deleteCustomPageComment(
    channelId: number,
    pageId: string,
    commentId: string,
    userId: number,
    canModerate: boolean,
  ): Promise<void> {
    const state = await this.getCustomPageCommentState(channelId, pageId);
    if (!state.page.commentsEnabled) {
      throw new BadRequestException('댓글이 비활성화된 페이지입니다.');
    }

    const target = state.comments.find((comment) => comment.id === commentId);
    if (!target) {
      throw new NotFoundException('댓글을 찾을 수 없습니다.');
    }
    if (target.userId !== userId && !canModerate) {
      throw new ForbiddenException('댓글을 삭제할 권한이 없습니다.');
    }

    const comments = state.comments.filter(
      (comment) => comment.id !== commentId,
    );
    await this.saveCustomPageComments(channelId, state, comments);
  }

  private async getCustomPageCommentState(
    channelId: number,
    pageId: string,
  ): Promise<{
    layout?: StoredFeatureLayout;
    guestbookEnabled?: boolean;
    customItems: ChannelCustomMenuItem[];
    page: ChannelCustomMenuItem;
    comments: StoredCustomPageComment[];
    commentsById: Map<string, StoredCustomPageComment[]>;
  }> {
    const [stored, channel] = await Promise.all([
      this.prisma.channelOverlayLayout.findUnique({
        where: {
          channelId_layoutType: {
            channelId,
            layoutType: CHANNEL_FEATURE_LAYOUT_TYPE,
          },
        },
        select: { layout: true },
      }),
      this.prisma.channel.findUnique({
        where: { id: channelId },
        select: { guestbookEnabled: true },
      }),
    ]);
    const layout = stored?.layout as StoredFeatureLayout | undefined;
    const customItems = await this.normalizeCustomItems(
      channelId,
      layout?.customItems,
      {
        includeDefault:
          !layout || (layout.version ?? 0) < CHANNEL_FEATURE_LAYOUT_VERSION,
        preserveStoredOrder: layout?.version === CHANNEL_FEATURE_LAYOUT_VERSION,
      },
    );
    const normalizedPageId = this.normalizeCustomId(pageId);
    const page = customItems.find(
      (item) => item.id === normalizedPageId && item.type === 'page',
    );
    if (!page) {
      throw new NotFoundException('커스텀 페이지를 찾을 수 없습니다.');
    }

    const commentsById = this.getStoredCustomPageCommentsById(
      layout?.customItems,
    );

    return {
      layout,
      guestbookEnabled: channel?.guestbookEnabled,
      customItems,
      page,
      comments: commentsById.get(page.id) ?? [],
      commentsById,
    };
  }

  private async saveCustomPageComments(
    channelId: number,
    state: {
      layout?: StoredFeatureLayout;
      guestbookEnabled?: boolean;
      customItems: ChannelCustomMenuItem[];
      page: ChannelCustomMenuItem;
      commentsById: Map<string, StoredCustomPageComment[]>;
    },
    comments: StoredCustomPageComment[],
  ): Promise<void> {
    const commentsById = new Map(state.commentsById);
    commentsById.set(state.page.id, comments);
    const items = this.normalizeItems(
      state.layout?.items,
      state.guestbookEnabled,
      {
        preserveStoredOrder:
          state.layout?.version === CHANNEL_FEATURE_LAYOUT_VERSION,
      },
    );
    const layout = {
      version: CHANNEL_FEATURE_LAYOUT_VERSION,
      items: items.map(({ key, label, isEnabled, order }) => ({
        key,
        label,
        isEnabled,
        order,
      })),
      customItems: state.customItems.map((item) =>
        this.toStoredCustomMenuItem(
          item,
          item.type === 'page'
            ? (commentsById.get(item.id) ?? [])
            : undefined,
        ),
      ),
    } satisfies Prisma.InputJsonObject;

    await this.prisma.channelOverlayLayout.upsert({
      where: {
        channelId_layoutType: {
          channelId,
          layoutType: CHANNEL_FEATURE_LAYOUT_TYPE,
        },
      },
      update: { layout },
      create: {
        channelId,
        layoutType: CHANNEL_FEATURE_LAYOUT_TYPE,
        layout,
      },
    });
  }

  private async toCustomPageCommentResults(
    channelId: number,
    comments: StoredCustomPageComment[],
    currentUserId?: number,
  ): Promise<ChannelCustomPageCommentResult[]> {
    const users = await this.prisma.user.findMany({
      where: {
        id: { in: [...new Set(comments.map((comment) => comment.userId))] },
      },
      select: { id: true, nickname: true, profileImageUrl: true },
    });
    const userById = new Map(users.map((user) => [user.id, user]));
    const canManageByUserId = currentUserId
      ? await this.canManageChannelSettings(channelId, currentUserId)
      : false;

    return comments.map((comment) => {
      const author = userById.get(comment.userId);
      const isAuthor = currentUserId === comment.userId;
      return {
        id: comment.id,
        content: comment.content,
        author: {
          id: comment.userId,
          nickname: author?.nickname ?? '탈퇴한 사용자',
          profileImageUrl: author?.profileImageUrl ?? null,
        },
        createdAt: comment.createdAt,
        updatedAt: comment.updatedAt,
        isEdited: comment.updatedAt !== comment.createdAt,
        canEdit: isAuthor,
        canDelete: isAuthor || canManageByUserId,
      };
    });
  }

  private async canManageChannelSettings(
    channelId: number,
    userId: number,
  ): Promise<boolean> {
    const [channel, manager] = await Promise.all([
      this.prisma.channel.findFirst({
        where: { id: channelId, userId },
        select: { id: true },
      }),
      this.prisma.channelManager.findUnique({
        where: { channelId_userId: { channelId, userId } },
        select: { isActive: true, canManageSettings: true },
      }),
    ]);

    return Boolean(channel || (manager?.isActive && manager.canManageSettings));
  }

  private normalizeCommentContent(content: unknown): string {
    if (typeof content !== 'string') {
      throw new BadRequestException('댓글 내용을 입력해주세요.');
    }
    const normalized = content.trim().slice(0, CUSTOM_PAGE_COMMENT_MAX_LENGTH);
    if (!normalized) {
      throw new BadRequestException('댓글 내용을 입력해주세요.');
    }
    return normalized;
  }

  private getStoredCustomPageCommentsById(
    input: unknown,
  ): Map<string, StoredCustomPageComment[]> {
    const commentsById = new Map<string, StoredCustomPageComment[]>();
    if (!Array.isArray(input)) return commentsById;

    for (const raw of input) {
      if (!raw || typeof raw !== 'object') continue;
      const candidate = raw as Record<string, unknown>;
      const id = this.normalizeCustomId(candidate.id);
      if (!id || candidate.type !== 'page') continue;
      commentsById.set(
        id,
        this.normalizeCustomPageComments(candidate.comments),
      );
    }

    return commentsById;
  }

  private normalizeCustomPageComments(
    input: unknown,
  ): StoredCustomPageComment[] {
    if (!Array.isArray(input)) return [];

    return input
      .map((raw) => {
        if (!raw || typeof raw !== 'object') return null;
        const candidate = raw as Record<string, unknown>;
        const id = typeof candidate.id === 'string' ? candidate.id : null;
        const userId =
          typeof candidate.userId === 'number' &&
          Number.isInteger(candidate.userId) &&
          candidate.userId > 0
            ? candidate.userId
            : null;
        const content =
          typeof candidate.content === 'string'
            ? candidate.content.trim().slice(0, CUSTOM_PAGE_COMMENT_MAX_LENGTH)
            : null;
        const createdAt =
          typeof candidate.createdAt === 'string' &&
          !Number.isNaN(Date.parse(candidate.createdAt))
            ? candidate.createdAt
            : null;
        const updatedAt =
          typeof candidate.updatedAt === 'string' &&
          !Number.isNaN(Date.parse(candidate.updatedAt))
            ? candidate.updatedAt
            : createdAt;

        if (!id || !userId || !content || !createdAt || !updatedAt) {
          return null;
        }

        return { id, userId, content, createdAt, updatedAt };
      })
      .filter((comment): comment is StoredCustomPageComment => !!comment)
      .sort(
        (a, b) =>
          new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime(),
      )
      .slice(-CUSTOM_PAGE_COMMENT_MAX_COUNT);
  }

  private toStoredCustomMenuItem(
    item: ChannelCustomMenuItem,
    comments?: StoredCustomPageComment[],
  ): Prisma.InputJsonObject {
    const base = {
      id: item.id,
      type: item.type,
      path: item.path,
      label: item.label,
      iconName: item.iconName ?? null,
      isEnabled: item.isEnabled,
      order: item.order,
    };

    if (item.type === 'page') {
      return {
        ...base,
        contentHtml: item.contentHtml ?? '',
        commentsEnabled: Boolean(item.commentsEnabled),
        comments: (comments ?? []).map((comment) => ({
          id: comment.id,
          userId: comment.userId,
          content: comment.content,
          createdAt: comment.createdAt,
          updatedAt: comment.updatedAt,
        })),
      };
    }

    return { ...base, boardId: Number(item.boardId) };
  }

  private normalizeCustomPath(path: unknown): string | null {
    if (typeof path !== 'string') return null;
    const normalized = path
      .trim()
      .toLowerCase()
      .replace(/^\/+|\/+$/g, '')
      .replace(/\/+/g, '/');
    if (!/^[a-z0-9][a-z0-9-]*(\/[a-z0-9][a-z0-9-]*){0,2}$/.test(normalized)) {
      return null;
    }
    const firstSegment = normalized.split('/')[0];
    if (CUSTOM_MENU_RESERVED_PATHS.has(firstSegment)) return null;
    return normalized;
  }

  private async normalizeCustomItems(
    channelId: number,
    input: unknown,
    options: {
      includeDefault?: boolean;
      validateBoardIds?: boolean;
      preserveStoredOrder?: boolean;
    } = {},
  ): Promise<ChannelCustomMenuItem[]> {
    const source = [
      ...(options.includeDefault ? DEFAULT_CHANNEL_CUSTOM_MENU_ITEMS : []),
      ...(Array.isArray(input) ? input : []),
    ];
    const byId = new Map<string, Record<string, unknown>>();
    const byPath = new Map<string, Record<string, unknown>>();

    for (const raw of source) {
      if (!raw || typeof raw !== 'object') continue;
      const candidate = raw as Record<string, unknown>;
      const id = this.normalizeCustomId(candidate.id);
      const path = this.normalizeCustomPath(candidate.path);
      if (!id || !path) continue;
      if (byPath.has(path) && byPath.get(path) !== byId.get(id)) continue;
      byId.set(id, candidate);
      byPath.set(path, candidate);
    }

    const items = [...byId.entries()]
      .map(([id, raw], index) => this.toCustomMenuItem(id, raw, index))
      .filter((item): item is ChannelCustomMenuItem => !!item)
      .sort((a, b) => {
        if (a.order !== b.order) return a.order - b.order;
        return a.id.localeCompare(b.id);
      })
      .map((item, index) => ({
        ...item,
        order: options.preserveStoredOrder
          ? item.order
          : index + DEFAULT_CHANNEL_FEATURE_SETTINGS.length,
      }));

    const boardIds = [
      ...new Set(
        items
          .filter((item) => item.type === 'board')
          .map((item) => item.boardId)
          .filter((id): id is number => typeof id === 'number'),
      ),
    ];
    if (boardIds.length === 0) return items;

    const boards = await this.prisma.communityBoard.findMany({
      where: { channelId, id: { in: boardIds }, isActive: true },
      select: { id: true, name: true },
    });
    const boardNameById = new Map(boards.map((board) => [board.id, board.name]));

    if (options.validateBoardIds) {
      const invalid = boardIds.filter((id) => !boardNameById.has(id));
      if (invalid.length > 0) {
        throw new BadRequestException('선택한 게시판을 찾을 수 없습니다.');
      }
    }

    return items.filter((item) => {
      if (item.type !== 'board') return true;
      const boardName = item.boardId ? boardNameById.get(item.boardId) : null;
      if (!boardName) return false;
      item.boardName = boardName;
      return true;
    });
  }

  private normalizeCustomId(value: unknown): string | null {
    if (typeof value !== 'string') return null;
    const normalized = value.trim().toLowerCase();
    return /^[a-z0-9][a-z0-9-]{0,39}$/.test(normalized) ? normalized : null;
  }

  private toCustomMenuItem(
    id: string,
    raw: Record<string, unknown>,
    index: number,
  ): ChannelCustomMenuItem | null {
    const path = this.normalizeCustomPath(raw.path);
    if (!path) return null;

    const type =
      raw.type === 'board' || raw.type === 'page'
        ? (raw.type as ChannelCustomMenuItemType)
        : null;
    if (!type) return null;

    const rawLabel = typeof raw.label === 'string' ? raw.label : '';
    const defaultLabel =
      typeof raw.defaultLabel === 'string' && raw.defaultLabel.trim()
        ? raw.defaultLabel.trim().slice(0, CUSTOM_MENU_LABEL_MAX_LENGTH)
        : rawLabel.trim().slice(0, CUSTOM_MENU_LABEL_MAX_LENGTH) ||
          (type === 'board' ? '게시판' : '페이지');
    const label =
      rawLabel.trim().slice(0, CUSTOM_MENU_LABEL_MAX_LENGTH) || defaultLabel;
    const rawOrder = raw.order;
    const order =
      typeof rawOrder === 'number' &&
      Number.isInteger(rawOrder) &&
      rawOrder >= 0
        ? rawOrder
        : DEFAULT_CHANNEL_FEATURE_SETTINGS.length + index;
    const fallbackIconName: ChannelCustomMenuIconName =
      id === 'rules' && type === 'page'
        ? 'ShieldCheck'
        : type === 'board'
          ? 'MessageSquare'
          : 'FileText';
    const iconName: ChannelCustomMenuIconName =
      typeof raw.iconName === 'string' &&
      CUSTOM_MENU_ICON_NAME_PATTERN.test(raw.iconName)
        ? raw.iconName
        : fallbackIconName;

    if (type === 'board') {
      const boardId = raw.boardId;
      if (!Number.isInteger(boardId) || Number(boardId) <= 0) return null;
      return {
        id,
        type,
        path,
        label,
        defaultLabel,
        iconName,
        isEnabled: typeof raw.isEnabled === 'boolean' ? raw.isEnabled : true,
        order,
        boardId: Number(boardId),
      };
    }

    const contentHtml =
      typeof raw.contentHtml === 'string'
        ? raw.contentHtml.slice(0, CUSTOM_MENU_CONTENT_MAX_LENGTH)
        : '';
    return {
      id,
      type,
      path,
      label,
      defaultLabel,
      iconName,
      isEnabled: typeof raw.isEnabled === 'boolean' ? raw.isEnabled : true,
      order,
      contentHtml,
      commentsEnabled:
        typeof raw.commentsEnabled === 'boolean'
          ? raw.commentsEnabled
          : false,
    };
  }

  private normalizeItems(
    input: unknown,
    fallbackGuestbookEnabled?: boolean,
    options: { preserveStoredOrder?: boolean } = {},
  ): ChannelFeatureSetting[] {
    const storedByKey = new Map<string, Record<string, unknown>>();
    if (Array.isArray(input)) {
      for (const item of input) {
        if (!item || typeof item !== 'object') continue;
        const candidate = item as Record<string, unknown>;
        const rawKey = candidate.key;
        const mappedKey =
          typeof rawKey === 'string' && LEGACY_FEATURE_KEY_MAP[rawKey]
            ? LEGACY_FEATURE_KEY_MAP[rawKey]
            : rawKey;
        if (isChannelFeatureKey(mappedKey)) {
          storedByKey.set(mappedKey, candidate);
        }
      }
    }

    const defaultOrder = new Map(
      DEFAULT_CHANNEL_FEATURE_SETTINGS.map((item, index) => [item.key, index]),
    );

    const normalized = DEFAULT_CHANNEL_FEATURE_SETTINGS.map((base) => {
      const stored = storedByKey.get(base.key);
      const rawLabel = typeof stored?.label === 'string' ? stored.label : '';
      const label = rawLabel.trim().slice(0, 24) || base.defaultLabel;
      const rawEnabled = stored?.isEnabled;
      const rawOrder = stored?.order;
      const order =
        options.preserveStoredOrder &&
        typeof rawOrder === 'number' &&
        Number.isInteger(rawOrder) &&
        rawOrder >= 0
          ? rawOrder
          : base.order;

      return {
        ...base,
        label,
        isEnabled:
          typeof rawEnabled === 'boolean'
            ? rawEnabled
            : base.key === 'guestbook' &&
                typeof fallbackGuestbookEnabled === 'boolean'
              ? fallbackGuestbookEnabled
              : base.isEnabled,
        order,
      };
    })
      .sort((a, b) => {
        if (a.order !== b.order) return a.order - b.order;
        return (defaultOrder.get(a.key) ?? 0) - (defaultOrder.get(b.key) ?? 0);
      });

    if (options.preserveStoredOrder) {
      return normalized;
    }

    return normalized.map((item, index) => ({ ...item, order: index }));
  }
}
