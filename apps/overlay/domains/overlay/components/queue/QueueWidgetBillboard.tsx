'use client';

import { memo, type CSSProperties } from 'react';

import {
  DEFAULT_LAYOUT_OPTIONS,
  type BillboardLayoutOptions,
  isBillboardOptions,
} from '@/domains/overlay/types/options';
import { buildBlurFilter } from '@/domains/overlay/themes/shared/apply-transparency';
import { useCommonOptions } from '@/domains/overlay/themes/shared/use-common-options';
import {
  useContainerUnitsSupport,
  cqwCap,
  fluidOr,
} from '@/domains/overlay/themes/shared/container-units';
import {
  resolveTextStroke,
  withTextStroke,
} from '@/domains/overlay/themes/shared/text-stroke';
import type {
  QueueItem,
  ConnectionStatus,
  QueueOmakaseSummary,
} from './QueueWidgetView';

interface QueueWidgetBillboardProps {
  layoutType: string;
  options?: Record<string, unknown>;
  queue: QueueItem[];
  omakase?: QueueOmakaseSummary | null;
  isSessionLive: boolean;
  isJoined: boolean;
  connectionStatus: ConnectionStatus;
  isLoading?: boolean;
  error?: Error | null;
}

function formatAvailableChannels(item: QueueItem): string | null {
  const names = (item.availableChannels ?? [])
    .map((channel) => channel.channelName)
    .filter(Boolean);
  if (names.length === 0) return null;
  const visible = names.slice(0, 2);
  const rest = names.length - visible.length;
  return `가능: ${visible.join(', ')}${rest > 0 ? ` 외 ${rest}명` : ''}`;
}

function QueueWidgetBillboard({
  options,
  queue,
  omakase,
  isSessionLive,
  isJoined,
  connectionStatus,
  isLoading,
  error,
}: QueueWidgetBillboardProps) {
  const opts: BillboardLayoutOptions = {
    ...DEFAULT_LAYOUT_OPTIONS.billboard,
    ...(isBillboardOptions(options) ? options : (options as Partial<BillboardLayoutOptions>)),
  };
  const common = useCommonOptions(options);
  const blurFilter = buildBlurFilter(common.blurIntensity);
  const supportsCq = useContainerUnitsSupport();
  const stroke = resolveTextStroke(options);

  const alignmentClass = {
    left: 'text-left items-start',
    center: 'text-center items-center',
    right: 'text-right items-end',
  }[opts.textAlign];

  const numberAlign = {
    left: 'text-right',
    center: 'text-center',
    right: 'text-left',
  }[opts.textAlign];

  const textShadow = withTextStroke(
    stroke,
    opts.transparentBackground
      ? '2px 2px 8px rgba(0, 0, 0, 0.5), 0 0 30px rgba(0, 0, 0, 0.3)'
      : undefined,
  );

  const subtleShadow = withTextStroke(
    stroke,
    opts.transparentBackground ? '1px 1px 4px rgba(0, 0, 0, 0.5)' : undefined,
  );

  const emptyMessage = isLoading
    ? '데이터 로딩 중...'
    : error
      ? `오류: ${error.message || '채널을 찾을 수 없습니다'}`
      : connectionStatus === 'disconnected'
        ? '서버 연결 대기 중...'
        : !isSessionLive
          ? '방송 대기 중...'
          : '대기 중인 곡이 없어요';

  // Admin px is the upper bound; cqw cap forces shrink in narrow widgets so
  // items never get clipped by the container.
  const rankPx = common.scale(Math.round(opts.titleFontSize * 0.9));
  const songTitlePx = common.scale(Math.round(opts.titleFontSize * 0.5));
  const artistPx = common.scale(Math.round(opts.artistFontSize * 0.6));

  const rankFontSize = cqwCap(rankPx, 12, supportsCq);
  const songTitleFontSize = cqwCap(songTitlePx, 6, supportsCq);
  const artistFontSize = cqwCap(artistPx, 5, supportsCq);

  const shellStyle: CSSProperties = {
    containerType: supportsCq ? 'inline-size' : undefined,
    padding: fluidOr('24px', 'min(24px, 4cqw)', supportsCq),
    backgroundColor: opts.transparentBackground ? 'transparent' : `rgba(0, 0, 0, ${0.5 * common.backgroundOpacity})`,
    backdropFilter: blurFilter,
    WebkitBackdropFilter: blurFilter,
  };

  return (
    <div
      className={`w-full h-full flex flex-col ${alignmentClass} overflow-hidden`}
      style={shellStyle}
    >
      {queue.length === 0 ? (
        <div className={`flex flex-col justify-center flex-1 ${alignmentClass}`}>
          {omakase?.enabled && omakase.count > 0 && (
            <div
              className="mb-5 px-4 py-2 rounded-lg"
              style={{
                color: opts.textColor,
                border: `1px solid ${opts.textColor}55`,
                background: `${opts.textColor}14`,
                textShadow: subtleShadow,
              }}
            >
              <span style={{ fontWeight: opts.fontWeight }}>
                {omakase.displayName} X {omakase.count}
              </span>
            </div>
          )}
          <div
            className="w-4 h-4 rounded-full mb-4"
            style={{
              backgroundColor: isJoined
                ? (opts as { accentColor?: string }).accentColor ?? opts.textColor
                : connectionStatus === 'disconnected' ? '#EF4444' : '#F59E0B',
              opacity: 0.7,
              animation: 'pulse 2s ease-in-out infinite',
            }}
          />
          <p
            style={{
              color: opts.textColor,
              fontSize: cqwCap(common.scale(18), 4.5, supportsCq),
              fontWeight: opts.fontWeight,
              opacity: 0.6,
              textShadow: subtleShadow,
            }}
          >
            {emptyMessage}
          </p>
        </div>
      ) : (
        <div data-overlay-scroll className="flex flex-col gap-2 flex-1 overflow-y-auto w-full">
          {omakase?.enabled && omakase.count > 0 && (
            <div
              className={`flex items-baseline gap-4 ${opts.textAlign === 'right' ? 'flex-row-reverse' : ''}`}
              style={{ color: opts.textColor, textShadow }}
            >
              <div className={`flex-shrink-0 ${numberAlign}`} style={{ fontSize: rankFontSize, fontWeight: opts.fontWeight }}>
                X
              </div>
              <div className={`flex-1 min-w-0 ${alignmentClass}`}>
                <div style={{ fontSize: songTitleFontSize, fontWeight: opts.fontWeight }}>
                  {omakase.displayName}
                </div>
                <div style={{ fontSize: artistFontSize, opacity: 0.75 }}>
                  {omakase.count}개
                </div>
              </div>
            </div>
          )}
          {queue.map((item, index) => (
            <div
              key={item.id}
              className={`flex items-baseline gap-4 ${opts.textAlign === 'right' ? 'flex-row-reverse' : ''}`}
            >
              <div
                className={`flex-shrink-0 leading-[1.3] py-[0.15em] px-[0.1em] ${numberAlign}`}
                style={{
                  color: opts.textColor,
                  fontSize: rankFontSize,
                  fontWeight: opts.fontWeight,
                  opacity: 0.35,
                  minWidth: fluidOr(
                    `${rankPx * 1.2}px`,
                    `min(${rankPx * 1.2}px, 14cqw)`,
                    supportsCq,
                  ),
                  textShadow,
                }}
              >
                {index + 1}
              </div>

              <div className="flex-1 min-w-0">
                <h3
                  className="leading-[1.3] truncate py-[0.2em] px-[0.1em]"
                  style={{
                    color: opts.textColor,
                    fontSize: songTitleFontSize,
                    fontWeight: opts.fontWeight,
                    textShadow,
                  }}
                >
                  {item.title}
                </h3>
                <p
                  className="leading-[1.3] truncate py-[0.2em] px-[0.1em]"
                  style={{
                    color: opts.textColor,
                    fontSize: artistFontSize,
                    fontWeight: opts.artistFontWeight ?? (parseInt(opts.fontWeight) >= 600 ? '500' : '400'),
                    opacity: 0.6,
                    textShadow: subtleShadow,
                  }}
                >
                  {item.artist}
                </p>
                {formatAvailableChannels(item) && (
                  <p
                    className="leading-[1.2] truncate px-[0.1em]"
                    style={{
                      color: opts.textColor,
                      fontSize: cqwCap(common.scale(13), 7, supportsCq),
                      opacity: 0.55,
                      textShadow: subtleShadow,
                    }}
                  >
                    {formatAvailableChannels(item)}
                  </p>
                )}
              </div>
            </div>
          ))}
        </div>
      )}

      <div
        className="mt-4 w-2 h-2 rounded-full"
        style={{
          backgroundColor: isJoined
            ? (opts as { accentColor?: string }).accentColor ?? opts.textColor
            : connectionStatus === 'disconnected' ? '#EF4444' : '#F59E0B',
          opacity: isJoined ? 0.5 : 0.8,
        }}
      />
    </div>
  );
}
QueueWidgetBillboard.displayName = 'QueueWidgetBillboard';
export default memo(QueueWidgetBillboard);
