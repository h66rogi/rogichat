'use client';

import { memo, type CSSProperties } from 'react';

import { NowPlayingProps } from './types';
import { BillboardLayoutOptions, DEFAULT_LAYOUT_OPTIONS } from '@/domains/overlay/types/options';
import { useCommonOptions } from '@/domains/overlay/themes/shared/use-common-options';
import { buildBlurFilter } from '@/domains/overlay/themes/shared/apply-transparency';
import {
  useContainerUnitsSupport,
  cqwCap,
  fluidOr,
} from '@/domains/overlay/themes/shared/container-units';
import {
  resolveTextStroke,
  withTextStroke,
} from '@/domains/overlay/themes/shared/text-stroke';

interface BillboardNowPlayingProps extends NowPlayingProps {
  options?: Partial<BillboardLayoutOptions>;
}

function formatAvailableChannels(
  channels?: Array<{ channelName: string }>,
): string | null {
  const names = (channels ?? [])
    .map((channel) => channel.channelName)
    .filter(Boolean);
  if (names.length === 0) return null;
  const visible = names.slice(0, 3);
  const rest = names.length - visible.length;
  return `가능: ${visible.join(', ')}${rest > 0 ? ` 외 ${rest}명` : ''}`;
}

function NowPlayingBillboard({
  nowPlaying,
  isJoined,
  connectionStatus,
  options,
}: BillboardNowPlayingProps) {
  const opts = { ...DEFAULT_LAYOUT_OPTIONS.billboard, ...options };
  const common = useCommonOptions(options as Record<string, unknown> | undefined);
  const blurFilter = buildBlurFilter(common.blurIntensity);
  const supportsCq = useContainerUnitsSupport();
  const stroke = resolveTextStroke(options as Record<string, unknown> | undefined);

  const alignmentClass = {
    left: 'text-left items-start',
    center: 'text-center items-center',
    right: 'text-right items-end',
  }[opts.textAlign];

  // admin-px는 항상 상한. cqw 지원 브라우저에서는 위젯이 좁을 때 자동 축소되고,
  // 비지원 브라우저에서는 admin px 그대로 유지되어 회귀 없이 동작.
  const shellStyle: CSSProperties = {
    containerType: supportsCq ? 'inline-size' : undefined,
    padding: fluidOr('24px', 'min(24px, 4cqw)', supportsCq),
    backgroundColor: opts.transparentBackground
      ? 'transparent'
      : `rgba(0, 0, 0, ${0.5 * common.backgroundOpacity})`,
    backdropFilter: blurFilter,
    WebkitBackdropFilter: blurFilter,
  };

  // No song playing state
  if (!nowPlaying) {
    return (
      <div
        className={`w-full h-full flex flex-col justify-center ${alignmentClass}`}
        style={shellStyle}
      >
        <div className={`flex flex-col ${alignmentClass}`}>
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
            }}
          >
            {connectionStatus === 'disconnected' ? '연결 대기 중...' : isJoined ? '대기 중' : '연결 중...'}
          </p>
        </div>
      </div>
    );
  }

  return (
    <div
      className={`w-full h-full flex flex-col justify-center ${alignmentClass}`}
      style={shellStyle}
    >
      {(nowPlaying.isDonation || nowPlaying.isHomework) && (
        <div className={`flex gap-2 mb-3 ${opts.textAlign === 'right' ? 'flex-row-reverse' : ''}`}>
          {nowPlaying.isDonation && (
            <span
              className="px-3 py-1 rounded-full font-bold uppercase tracking-wide whitespace-nowrap"
              style={{
                backgroundColor: (opts as { accentColor?: string }).accentColor ?? opts.textColor,
                color: opts.transparentBackground ? '#000' : 'rgba(0, 0, 0, 0.9)',
                fontSize: cqwCap(common.scale(16), 3.2, supportsCq),
              }}
            >
              후원곡
            </span>
          )}
          {nowPlaying.isHomework && (
            <span
              className="px-3 py-1 rounded-full font-bold uppercase tracking-wide whitespace-nowrap"
              style={{
                backgroundColor: (opts as { accentColor?: string }).accentColor ?? '#3B82F6',
                color: '#fff',
                fontSize: cqwCap(common.scale(16), 3.2, supportsCq),
              }}
            >
              숙제곡
            </span>
          )}
        </div>
      )}

      {/* Title clamp. titleLineClamp === 1 (기본) 이면 단일 라인 ellipsis.
         2 이상이면 해당 줄 수까지 표시 후 말줄임표. admin이 긴 한글 곡명을
         위해 여러 줄로 보고 싶을 때 대응. */}
      <h1
        className="leading-[1.3] mb-1 max-w-full py-[0.2em] px-[0.1em] block"
        style={{
          color: opts.textColor,
          fontSize: cqwCap(common.scale(opts.titleFontSize), 14, supportsCq),
          fontWeight: opts.fontWeight,
          overflow: 'hidden',
          ...((opts.titleLineClamp ?? 1) <= 1
            ? {
                whiteSpace: 'nowrap' as const,
                textOverflow: 'ellipsis' as const,
              }
            : {
                display: '-webkit-box',
                WebkitBoxOrient: 'vertical' as const,
                WebkitLineClamp: opts.titleLineClamp,
                wordBreak: 'break-word' as const,
                overflowWrap: 'break-word' as const,
              }),
          textShadow: withTextStroke(
            stroke,
            opts.transparentBackground
              ? '2px 2px 8px rgba(0, 0, 0, 0.5), 0 0 30px rgba(0, 0, 0, 0.3)'
              : undefined,
          ),
        }}
      >
        {nowPlaying.title}
      </h1>

      <h2
        className="leading-[1.3] max-w-full py-[0.2em] px-[0.1em] block"
        style={{
          color: opts.textColor,
          fontSize: cqwCap(common.scale(opts.artistFontSize), 9, supportsCq),
          fontWeight: opts.artistFontWeight ?? (parseInt(opts.fontWeight) >= 600 ? '500' : '400'),
          opacity: 0.8,
          whiteSpace: 'nowrap',
          overflow: 'hidden',
          textOverflow: 'ellipsis',
          textShadow: withTextStroke(
            stroke,
            opts.transparentBackground ? '1px 1px 4px rgba(0, 0, 0, 0.5)' : undefined,
          ),
        }}
      >
        {nowPlaying.artist}
      </h2>
      {formatAvailableChannels(nowPlaying.availableChannels) && (
        <p
          className="leading-[1.2] max-w-full truncate px-[0.1em]"
          style={{
            color: opts.textColor,
            fontSize: cqwCap(common.scale(18), 8, supportsCq),
            opacity: 0.65,
            textShadow: withTextStroke(
              stroke,
              opts.transparentBackground
                ? '1px 1px 4px rgba(0, 0, 0, 0.45)'
                : undefined,
            ),
          }}
        >
          {formatAvailableChannels(nowPlaying.availableChannels)}
        </p>
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
NowPlayingBillboard.displayName = 'NowPlayingBillboard';
export default memo(NowPlayingBillboard);
