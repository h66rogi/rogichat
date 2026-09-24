'use client';

import { memo, useEffect } from 'react';
import {
  DEFAULT_LAYOUT,
  type LayoutType,
  isValidLayoutType,
} from '@/domains/overlay/constants/layout-types';
import {
  DEFAULT_LAYOUT_OPTIONS,
  type AppleLayoutOptions,
  isAppleOptions,
} from '@/domains/overlay/types/options';
import { withOpacity, buildBlurFilter } from '@/domains/overlay/themes/shared/apply-transparency';
import { useCommonOptions } from '@/domains/overlay/themes/shared/use-common-options';
import QueueWidgetSpotify from './QueueWidgetSpotify';
import QueueWidgetBillboard from './QueueWidgetBillboard';

export interface QueueItem {
  id: number;
  title: string;
  artist: string;
  requester: string;
  position: number;
  isDonation?: boolean;
  donationAmount?: number;
  isHomework?: boolean;
  /** 랜덤 신청 (백엔드가 노래책에서 1곡 자동 추출). 일반 신청과 구분 표시용. */
  isRandom?: boolean;
  albumArt?: string;
  availableChannels?: Array<{ channelName: string }>;
}

export interface QueueOmakaseSummary {
  enabled: boolean;
  displayName: string;
  count: number;
}

export type ConnectionStatus =
  | 'connecting'
  | 'connected'
  | 'disconnected'
  | 'reconnecting';

interface QueueWidgetViewProps {
  layoutType: LayoutType;
  options?: Record<string, unknown>;
  queue: QueueItem[];
  omakase?: QueueOmakaseSummary | null;
  isSessionLive: boolean;
  isJoined: boolean;
  connectionStatus: ConnectionStatus;
  isLoading?: boolean;
  error?: Error | null;
}

const getAppleGlobalStyles = () => `
  @keyframes pulse {
    0%, 100% { opacity: 1; }
    50% { opacity: 0.6; }
  }
  @keyframes livePulse {
    0%, 100% { transform: scale(1); opacity: 1; }
    50% { transform: scale(1.05); opacity: 0.8; }
  }
`;

function QueueWidgetApple({
  options,
  queue,
  omakase,
  isSessionLive,
  isJoined,
  connectionStatus,
  isLoading,
  error,
}: QueueWidgetViewProps) {
  const opts: AppleLayoutOptions = {
    ...DEFAULT_LAYOUT_OPTIONS.apple,
    ...(isAppleOptions(options) ? options : (options as Partial<AppleLayoutOptions>)),
  };
  const common = useCommonOptions(options);
  const isDark = opts.theme === 'dark';
  const bgColor = isDark
    ? withOpacity('rgba(0, 0, 0, 0.78)', common.backgroundOpacity)
    : withOpacity('rgba(255, 255, 255, 0.92)', common.backgroundOpacity);
  const textColor = isDark ? '#ffffff' : '#1d1d1f';
  const mutedColor = isDark ? 'rgba(255, 255, 255, 0.6)' : 'rgba(0, 0, 0, 0.5)';
  const borderColor = isDark
    ? withOpacity('rgba(255, 255, 255, 0.12)', common.borderOpacity)
    : withOpacity('rgba(0, 0, 0, 0.08)', common.borderOpacity);
  const rowBg = isDark ? 'rgba(255, 255, 255, 0.06)' : 'rgba(0, 0, 0, 0.04)';
  const rowBorder = isDark
    ? withOpacity('rgba(255, 255, 255, 0.08)', common.borderOpacity)
    : withOpacity('rgba(0, 0, 0, 0.06)', common.borderOpacity);
  const blurFilter = buildBlurFilter(common.blurIntensity);

  const emptyMessage = isLoading
    ? '데이터 로딩 중...'
    : error
      ? `오류: ${error.message || '채널을 찾을 수 없습니다'}`
      : connectionStatus === 'disconnected'
        ? '서버 연결 대기 중...'
        : !isSessionLive
          ? '방송 대기 중...'
          : '대기 중인 곡이 없어요';

  useEffect(() => {
    const styleId = 'queue-widget-apple-styles';
    let style = document.getElementById(styleId) as HTMLStyleElement | null;
    if (!style) {
      style = document.createElement('style');
      style.id = styleId;
      document.head.appendChild(style);
    }
    style.textContent = getAppleGlobalStyles();
  }, []);

  return (
    <div
      className="w-full h-full"
      style={{
        background: 'transparent',
      }}
    >
      <div
        className="h-full w-full rounded-3xl p-5 flex flex-col overflow-hidden relative"
        style={{
          backgroundColor: bgColor,
          backdropFilter: blurFilter,
          WebkitBackdropFilter: blurFilter,
          border: `1px solid ${borderColor}`,
        }}
      >
        <div
          className="absolute inset-0 pointer-events-none"
          style={{
            background: `radial-gradient(circle at top right, ${opts.accentColor}22, transparent 55%)`,
          }}
        />

        <div
          className="relative flex items-start justify-between pb-4"
          style={{ borderBottom: `1px solid ${borderColor}` }}
        >
          <div>
            <h2 className="font-semibold tracking-tight" style={{ color: textColor, fontSize: `${common.scale(28)}px` }}>
              신청곡 대기열
            </h2>
            <p className="mt-0.5" style={{ color: mutedColor, fontSize: `${common.scale(19)}px` }}>
              {queue.length}곡 대기 중
            </p>
          </div>
          <div className="flex items-center gap-2">
            {isSessionLive && (
              <span
                className="px-2 py-0.5 rounded-full font-semibold"
                style={{
                  backgroundColor: `${opts.accentColor}22`,
                  color: opts.accentColor,
                  fontSize: `${common.scale(14)}px`,
                  animation: 'livePulse 2s ease-in-out infinite',
                }}
              >
                LIVE
              </span>
            )}
            <div
              className="w-2 h-2 rounded-full"
              style={{
                backgroundColor: isJoined ? opts.accentColor : connectionStatus === 'disconnected' ? '#EF4444' : '#F59E0B',
                boxShadow: isJoined ? `0 0 6px ${opts.accentColor}` : undefined,
                animation: 'pulse 2s ease-in-out infinite',
              }}
            />
          </div>
        </div>

        <div data-overlay-scroll className="relative flex-1 overflow-y-auto pt-4 space-y-2">
          {omakase?.enabled && omakase.count > 0 && (
            <div
              className="flex items-center justify-between gap-3 px-3 py-2 rounded-2xl"
              style={{
                backgroundColor: `${opts.accentColor}18`,
                border: `1px solid ${opts.accentColor}55`,
              }}
            >
              <span
                className="truncate font-semibold"
                style={{ color: textColor, fontSize: `${common.scale(17)}px` }}
              >
                {omakase.displayName}
              </span>
              <span
                className="flex-shrink-0 font-bold"
                style={{ color: opts.accentColor, fontSize: `${common.scale(18)}px` }}
              >
                {omakase.count}개
              </span>
            </div>
          )}
          {queue.length === 0 ? (
            <div className="flex items-center justify-center h-full">
              <p style={{ color: mutedColor, fontSize: `${common.scale(14)}px` }}>
                {emptyMessage}
              </p>
            </div>
          ) : (
            queue.map((item, index) => (
              <div
                key={item.id}
                className="flex items-center gap-3 px-3 py-2 rounded-2xl"
                style={{
                  backgroundColor: rowBg,
                  border: `1px solid ${rowBorder}`,
                }}
              >
                <div
                  className="flex-shrink-0 px-2 py-0.5 rounded-full font-semibold"
                  style={{
                    backgroundColor: `${opts.accentColor}22`,
                    color: opts.accentColor,
                    fontSize: `${common.scale(14)}px`,
                  }}
                >
                  {index + 1}
                </div>
                {item.albumArt ? (
                  <img
                    src={item.albumArt}
                    alt={item.title}
                    className="w-12 h-12 rounded-xl object-cover flex-shrink-0"
                    style={{ border: `1px solid ${borderColor}` }}
                  />
                ) : (
                  <div
                    className="w-12 h-12 rounded-xl flex items-center justify-center flex-shrink-0"
                    style={{ background: `${opts.accentColor}14`, border: `1px solid ${borderColor}` }}
                  >
                    <svg className="w-5 h-5" style={{ color: mutedColor }} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 19V6l12-3v13M9 19c0 1.105-1.343 2-3 2s-3-.895-3-2 1.343-2 3-2 3 .895 3 2zm12-3c0 1.105-1.343 2-3 2s-3-.895-3-2 1.343-2 3-2 3 .895 3 2zM9 10l12-3" />
                    </svg>
                  </div>
                )}
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="truncate" style={{ color: textColor, fontSize: `${common.scale(18)}px`, fontWeight: 700 }}>
                      {item.title}
                    </span>
                    {item.isDonation && (
                      <span
                        className="px-1.5 py-0.5 rounded-full font-semibold"
                        style={{
                          backgroundColor: opts.accentColor,
                          color: '#fff',
                          fontSize: `${common.scale(13)}px`,
                        }}
                      >
                        후원
                      </span>
                    )}
                    {item.isHomework && (
                      <span
                        className="px-1.5 py-0.5 rounded-full font-semibold"
                        style={{
                          backgroundColor: '#3B82F6',
                          color: '#fff',
                          fontSize: `${common.scale(13)}px`,
                        }}
                      >
                        숙제
                      </span>
                    )}

                    {item.isRandom && (
                      <span
                        className="px-1.5 py-0.5 rounded-full font-semibold"
                        style={{
                          backgroundColor: '#3B82F6',
                          color: '#fff',
                          fontSize: `${common.scale(13)}px`,
                        }}
                      >
                        랜덤
                      </span>
                    )}
                  </div>
                  <div className="truncate" style={{ color: mutedColor, fontSize: `${common.scale(16)}px` }}>
                    {item.artist}
                  </div>
                </div>
              </div>
            ))
          )}
        </div>

        <div
          className="pt-3 text-center"
          style={{ borderTop: `1px solid ${borderColor}` }}
        >
          <p style={{ color: mutedColor, fontSize: `${common.scale(13)}px` }}>
            meloming.com
          </p>
        </div>
      </div>
    </div>
  );
}

QueueWidgetApple.displayName = 'QueueWidgetApple';
const MemoizedQueueWidgetApple = memo(QueueWidgetApple);

function QueueWidgetView({ layoutType, ...rest }: QueueWidgetViewProps) {
  switch (layoutType) {
    case 'spotify':
      return <QueueWidgetSpotify layoutType={layoutType} {...rest} />;
    case 'billboard':
      return <QueueWidgetBillboard layoutType={layoutType} {...rest} />;
    case 'apple':
    default:
      return <MemoizedQueueWidgetApple layoutType={layoutType} {...rest} />;
  }
}
QueueWidgetView.displayName = 'QueueWidgetView';
const MemoizedQueueWidgetView = memo(QueueWidgetView);
export { MemoizedQueueWidgetView as QueueWidgetView };
