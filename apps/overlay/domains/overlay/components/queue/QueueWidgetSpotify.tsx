'use client';

import { useEffect, memo} from 'react';
import {
  DEFAULT_LAYOUT_OPTIONS,
  type SpotifyLayoutOptions,
  isSpotifyOptions,
} from '@/domains/overlay/types/options';
import { hexToRgba, withOpacity, buildBlurFilter } from '@/domains/overlay/themes/shared/apply-transparency';
import { useCommonOptions } from '@/domains/overlay/themes/shared/use-common-options';
import type {
  QueueItem,
  ConnectionStatus,
  QueueOmakaseSummary,
} from './QueueWidgetView';

interface QueueWidgetSpotifyProps {
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

const getSpotifyGlobalStyles = () => `
  @keyframes pulse {
    0%, 100% { opacity: 1; }
    50% { opacity: 0.6; }
  }
  @keyframes livePulse {
    0%, 100% { transform: scale(1); opacity: 1; }
    50% { transform: scale(1.05); opacity: 0.8; }
  }
`;

function QueueWidgetSpotify({
  options,
  queue,
  omakase,
  isSessionLive,
  isJoined,
  connectionStatus,
  isLoading,
  error,
}: QueueWidgetSpotifyProps) {
  const opts: SpotifyLayoutOptions = {
    ...DEFAULT_LAYOUT_OPTIONS.spotify,
    ...(isSpotifyOptions(options) ? options : (options as Partial<SpotifyLayoutOptions>)),
  };
  const common = useCommonOptions(options);

  const bgWithOpacity = hexToRgba(opts.backgroundColor, common.backgroundOpacity);
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
    const styleId = 'queue-widget-spotify-styles';
    let style = document.getElementById(styleId) as HTMLStyleElement | null;
    if (!style) {
      style = document.createElement('style');
      style.id = styleId;
      document.head.appendChild(style);
    }
    style.textContent = getSpotifyGlobalStyles();
  }, []);

  return (
    <div
      className="w-full h-full"
      style={{
        background: 'transparent',
      }}
    >
      <div
        className="h-full w-full rounded-2xl p-5 flex flex-col overflow-hidden"
        style={{
          backgroundColor: bgWithOpacity,
          backdropFilter: blurFilter,
          WebkitBackdropFilter: blurFilter,
        }}
      >
        {/* Header */}
        <div
          className="flex items-start justify-between pb-4"
          style={{ borderBottom: `1px solid ${withOpacity('rgba(255,255,255,0.1)', common.borderOpacity)}` }}
        >
          <div>
            <h2 className="font-bold tracking-tight text-white" style={{ fontSize: `${common.scale(28)}px` }}>
              대기열
            </h2>
            <p className="mt-0.5 text-gray-400" style={{ fontSize: `${common.scale(19)}px` }}>
              {queue.length}곡 대기 중
            </p>
          </div>
          <div className="flex items-center gap-2">
            {isSessionLive && (
              <span
                className="px-2 py-0.5 rounded-full font-semibold"
                style={{
                  backgroundColor: opts.progressBarColor,
                  color: '#000',
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
                backgroundColor: isJoined ? opts.progressBarColor : connectionStatus === 'disconnected' ? '#EF4444' : '#F59E0B',
                boxShadow: isJoined ? `0 0 8px ${opts.progressBarColor}` : undefined,
                animation: 'pulse 2s ease-in-out infinite',
              }}
            />
          </div>
        </div>

        {/* Queue List */}
        <div data-overlay-scroll className="flex-1 overflow-y-auto pt-4 space-y-1">
          {omakase?.enabled && omakase.count > 0 && (
            <div className="flex items-center justify-between gap-3 px-3 py-2 rounded-xl bg-white/10 border border-white/15">
              <span className="truncate font-semibold text-white" style={{ fontSize: `${common.scale(16)}px` }}>
                {omakase.displayName}
              </span>
              <span className="flex-shrink-0 font-bold text-[#1DB954]" style={{ fontSize: `${common.scale(17)}px` }}>
                {omakase.count}개
              </span>
            </div>
          )}
          {queue.length === 0 ? (
            <div className="flex items-center justify-center h-full">
              <p className="text-gray-400" style={{ fontSize: `${common.scale(14)}px` }}>
                {emptyMessage}
              </p>
            </div>
          ) : (
            queue.map((item, index) => (
              <div
                key={item.id}
                className="flex items-center gap-3 px-3 py-2.5 rounded-lg transition-colors"
                style={{
                  backgroundColor: 'rgba(255,255,255,0.05)',
                }}
              >
                {/* Position number */}
                <div
                  className="flex-shrink-0 w-6 text-right font-bold"
                  style={{ color: opts.progressBarColor, fontSize: `${common.scale(18)}px` }}
                >
                  {index + 1}
                </div>

                {/* Album art */}
                {item.albumArt ? (
                  <img
                    src={item.albumArt}
                    alt={item.title}
                    className="w-10 h-10 rounded shadow-lg object-cover flex-shrink-0"
                  />
                ) : (
                  <div
                    className="w-10 h-10 rounded flex items-center justify-center flex-shrink-0"
                    style={{ backgroundColor: '#282828' }}
                  >
                    <svg className="w-4 h-4 text-gray-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 19V6l12-3v13M9 19c0 1.105-1.343 2-3 2s-3-.895-3-2 1.343-2 3-2 3 .895 3 2zm12-3c0 1.105-1.343 2-3 2s-3-.895-3-2 1.343-2 3-2 3 .895 3 2zM9 10l12-3" />
                    </svg>
                  </div>
                )}

                {/* Song info */}
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="truncate text-white" style={{ fontSize: `${common.scale(18)}px`, fontWeight: 700 }}>
                      {item.title}
                    </span>
                    {item.isDonation && (
                      <span
                        className="px-1.5 py-0.5 rounded-full font-medium uppercase"
                        style={{
                          backgroundColor: opts.progressBarColor,
                          color: '#000',
                          fontSize: `${common.scale(13)}px`,
                        }}
                      >
                        후원
                      </span>
                    )}
                    {item.isHomework && (
                      <span
                        className="px-1.5 py-0.5 rounded-full font-medium uppercase bg-blue-500 text-white"
                        style={{ fontSize: `${common.scale(13)}px` }}
                      >
                        숙제
                      </span>
                    )}

                    {item.isRandom && (
                      <span
                        className="px-1.5 py-0.5 rounded-full font-medium uppercase bg-purple-500 text-white"
                        style={{ fontSize: `${common.scale(13)}px` }}
                      >
                        랜덤
                      </span>
                    )}
                  </div>
                  <div className="truncate text-gray-400" style={{ fontSize: `${common.scale(16)}px` }}>
                    {item.artist}
                  </div>
                  {formatAvailableChannels(item) && (
                    <div className="truncate text-gray-500" style={{ fontSize: `${common.scale(13)}px` }}>
                      {formatAvailableChannels(item)}
                    </div>
                  )}
                </div>

                {/* Requester */}
                <div className="flex-shrink-0 text-gray-500 truncate max-w-[80px]" style={{ fontSize: `${common.scale(16)}px` }}>
                  {item.requester}
                </div>
              </div>
            ))
          )}
        </div>

        {/* Footer */}
        <div
          className="pt-3 text-center"
          style={{ borderTop: `1px solid ${withOpacity('rgba(255,255,255,0.1)', common.borderOpacity)}` }}
        >
          <p className="text-gray-500" style={{ fontSize: `${common.scale(13)}px` }}>
            meloming.com
          </p>
        </div>
      </div>
    </div>
  );
}
QueueWidgetSpotify.displayName = 'QueueWidgetSpotify';
export default memo(QueueWidgetSpotify);
