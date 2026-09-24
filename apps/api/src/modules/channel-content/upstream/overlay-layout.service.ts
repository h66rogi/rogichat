import { Injectable, BadRequestException } from '@nestjs/common';
import { Prisma } from '../../../generated/prisma/client.js';
import {
  DEFAULT_SYNC_TOTAL_OVERLAY_LAYOUT,
  DEFAULT_TOTAL_OVERLAY_LAYOUT,
} from './overlay-layout.constants.js';

export const OVERLAY_LAYOUT_TYPES = ['total', 'sync-total'] as const;
export type OverlayLayoutType = (typeof OVERLAY_LAYOUT_TYPES)[number];
export interface OverlayLayoutSnapshot {
  layout: Record<string, unknown>;
  layoutVersion: number;
  layoutUpdatedAt: string | null;
}

/**
 * 통합 레이아웃 변경 WS 이벤트 이름.
 * 컨트롤러가 upsert 후 발행하면, overlay-stream events service가 받아
 * total widget room에 'layout.updated' 이벤트로 fanout한다.
 */
export const OVERLAY_LAYOUT_CONFIG_UPDATED_EVENT =
  'overlay.layout-config.updated';

const SYNC_TOTAL_RENDERED_WIDGET_IDS = new Set([
  'queue',
  'now-playing',
  'chatbox',
  'setlist',
  'songbook-qr',
]);

const LEGACY_STANDARD_TOTAL_WIDGET_GEOMETRY = {
  queue: { enabled: false, x: 0.0297, y: 0.0547, w: 0.2008, h: 0.909 },
  'now-playing': {
    enabled: false,
    x: 0.2584,
    y: 0.2561,
    w: 0.3855,
    h: 0.2439,
  },
  setlist: { enabled: true, x: 0.02, y: 0.04, w: 0.2183, h: 0.5496 },
  lyrics: { enabled: true, x: 0.2507, y: 0.7801, w: 0.4987, h: 0.1807 },
} as const;

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function getWidgetMap(layout: Record<string, unknown>) {
  const widgets = Array.isArray(layout.widgets)
    ? (layout.widgets as Array<Record<string, unknown>>)
    : [];
  return new Map(
    widgets
      .filter((widget) => widget && typeof widget.id === 'string')
      .map((widget) => [widget.id as string, widget]),
  );
}

function isCloseTo(value: unknown, expected: number): boolean {
  return (
    typeof value === 'number' && Math.abs(value - expected) <= 0.000001
  );
}

function isLegacyStandardTotalLayout(
  layout?: Record<string, unknown> | null,
): boolean {
  if (!layout || !isRecord(layout)) {
    return false;
  }

  const widgetMap = getWidgetMap(layout);
  return Object.entries(LEGACY_STANDARD_TOTAL_WIDGET_GEOMETRY).every(
    ([id, expected]) => {
      const widget = widgetMap.get(id);
      if (!widget) {
        return false;
      }
      return (
        widget.enabled === expected.enabled &&
        isCloseTo(widget.x, expected.x) &&
        isCloseTo(widget.y, expected.y) &&
        isCloseTo(widget.w, expected.w) &&
        isCloseTo(widget.h, expected.h)
      );
    },
  );
}

function isLegacyStandardNowPlayingWidget(
  widget?: Record<string, unknown>,
): boolean {
  if (!widget) {
    return false;
  }
  const expected = LEGACY_STANDARD_TOTAL_WIDGET_GEOMETRY['now-playing'];
  return (
    widget.enabled === false &&
    isCloseTo(widget.x, expected.x) &&
    isCloseTo(widget.y, expected.y) &&
    isCloseTo(widget.w, expected.w) &&
    isCloseTo(widget.h, expected.h)
  );
}

function toSnapshot(
  layout: Record<string, unknown>,
  version = 0,
  updatedAt: Date | string | null = null,
): OverlayLayoutSnapshot {
  return {
    layout,
    layoutVersion: version,
    layoutUpdatedAt:
      updatedAt instanceof Date
        ? updatedAt.toISOString()
        : updatedAt
          ? new Date(updatedAt).toISOString()
          : null,
  };
}

function cloneLayout(layout: {
  version: number;
  aspect: string;
  widgets: readonly Record<string, unknown>[];
}) {
  return {
    ...layout,
    widgets: layout.widgets.map((widget) => ({ ...widget })),
  };
}

function normalizeSyncTotalLayout(layout?: Record<string, unknown> | null) {
  const parsed: Record<string, unknown> = isRecord(layout) ? layout : {};
  const widgetMap = getWidgetMap(parsed);

  return {
    ...DEFAULT_SYNC_TOTAL_OVERLAY_LAYOUT,
    ...parsed,
    widgets: DEFAULT_SYNC_TOTAL_OVERLAY_LAYOUT.widgets.map((widget) => {
      const saved = widgetMap.get(widget.id);
      const enabled =
        SYNC_TOTAL_RENDERED_WIDGET_IDS.has(widget.id) &&
        (typeof saved?.enabled === 'boolean' ? saved.enabled : widget.enabled);
      return {
        ...widget,
        ...(saved ?? {}),
        enabled,
      };
    }),
  };
}

function normalizeTotalLayout(layout?: Record<string, unknown> | null) {
  const parsed: Record<string, unknown> = isRecord(layout) ? layout : {};
  if (isLegacyStandardTotalLayout(parsed)) {
    return cloneLayout(DEFAULT_TOTAL_OVERLAY_LAYOUT);
  }

  const widgetMap = getWidgetMap(parsed);
  const shouldRepairNowPlaying = isLegacyStandardNowPlayingWidget(
    widgetMap.get('now-playing'),
  );
  return {
    ...DEFAULT_TOTAL_OVERLAY_LAYOUT,
    ...parsed,
    widgets: DEFAULT_TOTAL_OVERLAY_LAYOUT.widgets.map((widget) => {
      const saved = widgetMap.get(widget.id);
      if (widget.id === 'now-playing' && shouldRepairNowPlaying) {
        return { ...widget };
      }
      return {
        ...widget,
        ...(saved ?? {}),
      };
    }),
  };
}

function normalizeLayout(
  layoutType: OverlayLayoutType,
  layout?: Record<string, unknown> | null,
) {
  return layoutType === 'sync-total'
    ? normalizeSyncTotalLayout(layout)
    : normalizeTotalLayout(layout);
}

@Injectable()
export class OverlayLayoutService {
  constructor(private readonly prisma: Prisma.TransactionClient) {}

  validateLayoutType(layoutType: string): OverlayLayoutType {
    if (!OVERLAY_LAYOUT_TYPES.includes(layoutType as OverlayLayoutType)) {
      throw new BadRequestException('Unsupported layout type');
    }
    return layoutType as OverlayLayoutType;
  }

  getDefaultLayout(layoutType: OverlayLayoutType): Record<string, unknown> {
    switch (layoutType) {
      case 'sync-total':
        return cloneLayout(DEFAULT_SYNC_TOTAL_OVERLAY_LAYOUT);
      case 'total':
      default:
        return cloneLayout(DEFAULT_TOTAL_OVERLAY_LAYOUT);
    }
  }

  async getLayout(
    channelId: string,
    layoutType: OverlayLayoutType,
  ): Promise<Record<string, unknown>> {
    return (await this.getLayoutSnapshot(channelId, layoutType)).layout;
  }

  async getLayoutSnapshot(
    channelId: string,
    layoutType: OverlayLayoutType,
  ): Promise<OverlayLayoutSnapshot> {
    const layout = await this.prisma.channelOverlayLayout.findUnique({
      where: {
        channelId_layoutType: {
          channelId,
          layoutType,
        },
      },
      select: { layout: true, version: true, updatedAt: true },
    });

    if (layout?.layout) {
      return toSnapshot(
        normalizeLayout(layoutType, layout.layout as Record<string, unknown>),
        layout.version,
        layout.updatedAt,
      );
    }

    if (layoutType === 'sync-total') {
      const fallback = await this.prisma.channelOverlayLayout.findUnique({
        where: {
          channelId_layoutType: {
            channelId,
            layoutType: 'total',
          },
        },
        select: { layout: true },
      });
      if (fallback?.layout) {
        return toSnapshot(
          normalizeSyncTotalLayout(fallback.layout as Record<string, unknown>),
        );
      }
    }

    return toSnapshot(this.getDefaultLayout(layoutType));
  }

  async upsertLayout(
    channelId: string,
    layoutType: OverlayLayoutType,
    layout: Record<string, unknown>,
  ): Promise<OverlayLayoutSnapshot> {
    const normalizedLayout = normalizeLayout(layoutType, layout);
    const layoutJson = normalizedLayout as Prisma.InputJsonValue;
    const saved = await this.prisma.channelOverlayLayout.upsert({
      where: {
        channelId_layoutType: {
          channelId,
          layoutType,
        },
      },
      update: {
        layout: layoutJson,
        version: { increment: 1 },
      },
      create: {
        channelId,
        layoutType,
        layout: layoutJson,
        version: 1,
      },
      select: {
        layout: true,
        version: true,
        updatedAt: true,
      },
    });

    return toSnapshot(
      normalizeLayout(layoutType, saved.layout as Record<string, unknown>),
      saved.version,
      saved.updatedAt,
    );
  }

}
