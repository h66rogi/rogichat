import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { Prisma } from '../../../generated/prisma/client.js';
import { UpdateOverlayThemeDto } from './dto/request/overlay-theme.request.dto.js';
import { OverlayThemeResponseDto } from './dto/response/overlay-theme.response.dto.js';
import { isValidThemeId } from './theme-manifest/theme-ids.js';
import { getThemeCatalogEntry } from './theme-manifest/catalog.js';
import {
  WIDGET_TYPES,
  isValidWidgetType,
} from './theme-manifest/widget-types.js';
import type { WidgetType } from './theme-manifest/widget-types.js';

export const DEFAULT_OVERLAY_THEME_ID = 'apple';

/**
 * 모든 테마가 공유하는 8개 공통 옵션 key. theme-agnostic이라 channel
 * default options에서 widget 단위로 머지될 때도 항상 유지된다.
 */
const COMMON_OPTION_KEYS = new Set<string>([
  'fontFamily',
  'textSize',
  'textWeight',
  'textColor',
  'accentColor',
  'backgroundOpacity',
  'borderOpacity',
  'blurIntensity',
]);

const ALLOWED_TEXT_WEIGHTS = new Set<string>([
  'light',
  'normal',
  'medium',
  'semibold',
  'bold',
  'black',
]);

const HEX_PATTERN = /^#[0-9a-fA-F]{6}$|^#[0-9a-fA-F]{3}$/;

/**
 * 외부 API 호출자가 보낸 invalid common option 값을 strip한다. UI는
 * ColorField 등에서 클라이언트 측 가드를 하지만, 직접 API 호출 / 외부 스크립트
 * / 오래된 클라이언트 경로는 여전히 backend 통과하므로 last-line defense.
 */
function sanitizeCommonOptions(
  options: Record<string, unknown>,
): Record<string, unknown> {
  const out = { ...options };
  for (const key of ['textColor', 'accentColor']) {
    const v = out[key];
    if (v === undefined || v === null) continue;
    if (typeof v !== 'string' || !HEX_PATTERN.test(v)) {
      delete out[key];
    }
  }
  if ('textSize' in out) {
    const v = out.textSize;
    if (typeof v !== 'number' || !Number.isFinite(v) || v < 0.4 || v > 2.0) {
      delete out.textSize;
    }
  }
  if ('textWeight' in out) {
    const v = out.textWeight;
    if (typeof v !== 'string' || !ALLOWED_TEXT_WEIGHTS.has(v.toLowerCase())) {
      delete out.textWeight;
    }
  }
  if ('fontFamily' in out) {
    const v = out.fontFamily;
    if (v !== null && (typeof v !== 'string' || v.length > 200)) {
      delete out.fontFamily;
    }
  }

  // backgroundOpacity: 0-100 정수, 기본 100 (완전 불투명)
  if ('backgroundOpacity' in out) {
    const v = out.backgroundOpacity;
    if (typeof v !== 'number' || !Number.isFinite(v) || v < 0 || v > 100) {
      delete out.backgroundOpacity;
    }
  }

  // borderOpacity: 0-100 정수, 기본 100 (완전 불투명)
  if ('borderOpacity' in out) {
    const v = out.borderOpacity;
    if (typeof v !== 'number' || !Number.isFinite(v) || v < 0 || v > 100) {
      delete out.borderOpacity;
    }
  }

  // blurIntensity: 0-40 정수 (px)
  if ('blurIntensity' in out) {
    const v = out.blurIntensity;
    if (typeof v !== 'number' || !Number.isFinite(v) || v < 0 || v > 40) {
      delete out.blurIntensity;
    }
  }

  return out;
}

/**
 * channel default options에서 common 옵션만 추출.
 */
function pickCommonOptions(
  options: Record<string, unknown>,
): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const key of COMMON_OPTION_KEYS) {
    if (key in options) out[key] = options[key];
  }
  return out;
}

/**
 * channel default options에서 theme-specific keys만 추출 (common 5종 제외).
 */
function pickThemeSpecificOptions(
  options: Record<string, unknown>,
): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(options)) {
    if (!COMMON_OPTION_KEYS.has(key)) out[key] = value;
  }
  return out;
}

function resolveThemeIdOrFallback(themeId: string): string {
  return isValidThemeId(themeId) ? themeId : DEFAULT_OVERLAY_THEME_ID;
}

function resolveThemeIdForWidget(
  themeId: string,
  _widgetType: WidgetType,
): string {
  void _widgetType;
  return resolveThemeIdOrFallback(themeId);
}

/**
 * Per-widget hardcoded default theme. Used when a channel hasn't set an
 * explicit override for that widget — the widget's preferred theme takes
 * precedence over the channel-level `defaultThemeId`.
 *
 * Lyrics 위젯은 Spotify 톤(다크 카드 + 흰 텍스트 + 그린 accent)을 기본으로
 * 한다. 노래방/플레이어 컨텍스트에 친숙하고, 명시 override 분포에서도 가장
 * 많이 자발 선택되는 테마라 사용자 기대치와 일치.
 */
const WIDGET_DEFAULT_THEME_OVERRIDE: Partial<Record<WidgetType, string>> = {
  lyrics: 'spotify',
};

function resolveDefaultThemeForWidget(
  channelDefaultThemeId: string,
  widgetType: WidgetType,
): string {
  const widgetDefault = WIDGET_DEFAULT_THEME_OVERRIDE[widgetType];
  if (widgetDefault && isValidThemeId(widgetDefault)) return widgetDefault;
  return resolveThemeIdOrFallback(channelDefaultThemeId);
}

/**
 * 통합 WS 이벤트 이름.
 * 기존 `overlay.channel-theme.updated`를 대체하며 `resolvedOptions`도 포함.
 */
export const OVERLAY_THEME_CONFIG_UPDATED_EVENT =
  'overlay.theme-config.updated';

/** 레거시 이벤트 이름 — dual-emit 전환기 동안 유지 */
export const OVERLAY_CHANNEL_THEME_UPDATED_EVENT =
  'overlay.channel-theme.updated';

@Injectable()
export class OverlayThemeService {
  private readonly logger = new Logger(OverlayThemeService.name);

  constructor(private readonly prisma: Prisma.TransactionClient) {}

  // ── 관리 UI용 ────────────────────────────────────────

  /**
   * 채널의 테마 설정을 조회합니다 (관리 UI용).
   * 저장된 값이 없으면 기본값을 lazy-create하고 반환합니다.
   */
  async getThemeConfig(channelId: string): Promise<OverlayThemeResponseDto> {
    const channelTheme = await this.getOrCreateChannelTheme(channelId);
    const widgetThemes =
      await this.prisma.channelOverlayWidgetTheme.findMany({
        where: { channelId },
      });

    const widgets: Record<
      string,
      { themeId: string | null; options: Record<string, unknown> | null }
    > = {};
    for (const wt of WIDGET_TYPES) {
      const override = widgetThemes.find((w) => w.widgetType === wt);
      widgets[wt] = {
        themeId:
          override?.themeId != null
            ? resolveThemeIdForWidget(override.themeId, wt)
            : null,
        options: (override?.options as Record<string, unknown>) ?? null,
      };
    }

    return {
      default: {
        themeId: resolveThemeIdOrFallback(channelTheme.defaultThemeId),
        options: channelTheme.defaultOptions as Record<string, unknown>,
      },
      widgets,
    };
  }

  /**
   * 채널의 테마 설정을 배치 업데이트합니다 (PUT).
   * Transaction 내에서 채널 기본 + 위젯별 override를 atomic으로 upsert.
   */
  async updateThemeConfig(
    channelId: string,
    dto: UpdateOverlayThemeDto,
  ): Promise<OverlayThemeResponseDto> {
    if (!isValidThemeId(dto.themeId)) {
      throw new BadRequestException(
        `유효하지 않은 themeId: ${dto.themeId}`,
      );
    }

    // 위젯별 override 수동 검증 (@ValidateNested가 Record에 동작 안 해서 여기서 수행).
    if (dto.widgets) {
      for (const key of Object.keys(dto.widgets)) {
        if (!isValidWidgetType(key)) {
          throw new BadRequestException(
            `유효하지 않은 위젯 타입: ${key}`,
          );
        }
        const w = dto.widgets[key];
        // entry value shape 검증 — null이나 비객체면 reject.
        if (w === null || typeof w !== 'object' || Array.isArray(w)) {
          throw new BadRequestException(
            `widgets[${key}]는 객체여야 합니다 (received: ${typeof w})`,
          );
        }
        if (
          w.themeId !== undefined &&
          w.themeId !== null &&
          !isValidThemeId(w.themeId)
        ) {
          throw new BadRequestException(
            `widgets[${key}].themeId가 유효하지 않습니다: ${w.themeId}`,
          );
        }
        if (
          w.options !== undefined &&
          w.options !== null &&
          (typeof w.options !== 'object' || Array.isArray(w.options))
        ) {
          throw new BadRequestException(
            `widgets[${key}].options는 객체/null/undefined여야 합니다`,
          );
        }
      }
    }

    const tx = this.prisma;
    {
      // 1. 채널 기본 upsert.
      //
      // PUT semantic: dto.options가 명시적으로 제공되면 전체 교체, undefined
      // (body에서 누락)이면 기존 DB 값 보존. 이전 동작은 undefined를 `{}`로
      // 대체해 호출자가 options 필드를 생략하면 매 저장마다 defaultOptions를
      // 통째로 날리던 문제가 있었음.
      //
      // 추가 sanitize: common 5종 옵션은 외부 호출자가 invalid hex/range/weight
      // 를 보내도 service에서 strip해 widget이 invalid CSS로 렌더되지 않게 함.
      const sanitizedDefaultOptions =
        dto.options !== undefined
          ? sanitizeCommonOptions(dto.options as Record<string, unknown>)
          : undefined;
      const updateData: Prisma.ChannelOverlayThemeUpdateInput = {
        defaultThemeId: dto.themeId,
      };
      if (sanitizedDefaultOptions !== undefined) {
        updateData.defaultOptions = sanitizedDefaultOptions as Prisma.InputJsonValue;
      }
      await tx.channelOverlayTheme.upsert({
        where: { channelId },
        update: updateData,
        create: {
          channelId,
          defaultThemeId: dto.themeId,
          defaultOptions: (sanitizedDefaultOptions ?? {}) as Prisma.InputJsonValue,
        },
      });

      // 2. 위젯별 upsert
      if (dto.widgets) {
        for (const wt of WIDGET_TYPES) {
          const w = dto.widgets[wt];
          if (!w) continue;

          const isInherited =
            (w.themeId === null || w.themeId === undefined) &&
            (w.options === null || w.options === undefined);

          if (isInherited) {
            await tx.channelOverlayWidgetTheme.deleteMany({
              where: { channelId, widgetType: wt },
            });
          } else {
            const sanitizedWidgetOptions =
              w.options === null || w.options === undefined
                ? null
                : sanitizeCommonOptions(w.options as Record<string, unknown>);
            await tx.channelOverlayWidgetTheme.upsert({
              where: {
                channelId_widgetType: { channelId, widgetType: wt },
              },
              update: {
                themeId: w.themeId ?? null,
                options:
                  sanitizedWidgetOptions === null
                    ? Prisma.DbNull
                    : (sanitizedWidgetOptions as Prisma.InputJsonValue),
              },
              create: {
                channelId,
                widgetType: wt,
                themeId: w.themeId ?? null,
                options:
                  sanitizedWidgetOptions === null
                    ? Prisma.DbNull
                    : (sanitizedWidgetOptions as Prisma.InputJsonValue),
              },
            });
          }
        }
      }
    }

    return this.getThemeConfig(channelId);
  }

  // ── Overlay 렌더용 ───────────────────────────────────

  /**
   * 위젯별 resolved 테마/옵션을 계산합니다 (overlay 렌더용).
   *
   * 머지 정책 (spec §3):
   * - 위젯이 다른 테마로 override → 채널 기본 옵션 적용 안 함
   * - 위젯이 채널 기본 상속 → 채널 기본 옵션도 머지
   */
  async resolveForOverlay(channelId: string): Promise<{
    resolvedThemes: Record<string, string>;
    resolvedOptions: Record<string, Record<string, unknown>>;
  }> {
    const channelTheme = await this.getOrCreateChannelTheme(channelId);
    const widgetThemes =
      await this.prisma.channelOverlayWidgetTheme.findMany({
        where: { channelId },
      });

    const resolvedThemes: Record<string, string> = {};
    const resolvedOptions: Record<string, Record<string, unknown>> = {};

    for (const wt of WIDGET_TYPES) {
      const override = widgetThemes.find((w) => w.widgetType === wt);
      const rawOverrideThemeId = override?.themeId ?? null;
      const rawDefaultThemeId = channelTheme.defaultThemeId;
      const overrideThemeId = rawOverrideThemeId
        ? resolveThemeIdForWidget(rawOverrideThemeId, wt)
        : null;
      const defaultThemeId = resolveDefaultThemeForWidget(rawDefaultThemeId, wt);
      const effectiveThemeId = overrideThemeId ?? defaultThemeId;
      resolvedThemes[wt] = effectiveThemeId;

      const catalogDefaults = this.getCatalogDefaults(effectiveThemeId);

      // 머지: catalog default ← channel common ← (조건적) channel specific ← widget override
      //
      // widgetForcedDefault 가 true 인 widget (예: lyrics → spotify) 은
      // 채널 default theme 와 무관하게 catalog 의 forced theme 톤을 그대로
      // 유지해야 한다. 따라서 channelCommon/Specific spread 를 차단하고
      // catalog defaults 만 base 로 깐다. 단 widget-level override 는
      // 사용자 customize 자유 보장을 위해 그대로 위에 올린다.
      const widgetForcedDefault =
        overrideThemeId === null && wt in WIDGET_DEFAULT_THEME_OVERRIDE;
      const channelOptions = (channelTheme.defaultOptions ?? {}) as Record<
        string,
        unknown
      >;
      const channelCommon = widgetForcedDefault
        ? {}
        : pickCommonOptions(channelOptions);
      const sameRawTheme =
        rawOverrideThemeId === null || rawOverrideThemeId === rawDefaultThemeId;
      const channelDefaultMatchesEffective =
        rawDefaultThemeId === effectiveThemeId;
      const shouldMergeChannelSpecific =
        !widgetForcedDefault && sameRawTheme && channelDefaultMatchesEffective;
      const channelSpecific = shouldMergeChannelSpecific
        ? pickThemeSpecificOptions(channelOptions)
        : {};

      resolvedOptions[wt] = {
        ...catalogDefaults,
        ...channelCommon,
        ...channelSpecific,
        ...((override?.options as Record<string, unknown>) ?? {}),
      };
    }

    return { resolvedThemes, resolvedOptions };
  }

  // ── Internal helpers ─────────────────────────────────

  /**
   * 채널 테마 레코드를 조회하고, 없으면 기본값으로 lazy-create합니다.
   */
  async getOrCreateChannelTheme(channelId: string) {
    const existing = await this.prisma.channelOverlayTheme.findUnique({
      where: { channelId },
    });
    if (existing) return existing;

    return this.prisma.channelOverlayTheme.create({
      data: {
        channelId,
        defaultThemeId: DEFAULT_OVERLAY_THEME_ID,
        defaultOptions: {},
      },
    });
  }

  /**
   * 테마 카탈로그에서 defaultOptions를 가져옵니다.
   * 레거시 테마(apple 등)는 카탈로그에 없으므로 빈 객체를 반환합니다.
   */
  getCatalogDefaults(themeId: string): Record<string, unknown> {
    const entry = getThemeCatalogEntry(themeId);
    return entry?.defaultOptions ?? {};
  }
}
