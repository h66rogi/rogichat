'use client';

import { memo } from 'react';

import { NowPlayingProps, formatTime, shouldShowPlaybackProgress } from './types';
import { AppleLayoutOptions, DEFAULT_LAYOUT_OPTIONS } from '@/domains/overlay/types/options';
import { useCommonOptions } from '@/domains/overlay/themes/shared/use-common-options';
import { buildBlurFilter } from '@/domains/overlay/themes/shared/apply-transparency';

interface AppleNowPlayingProps extends NowPlayingProps {
  options?: Partial<AppleLayoutOptions>;
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

function NowPlayingApple({
  nowPlaying,
  playbackProgress,
  isJoined,
  connectionStatus,
  options,
  reducedMotion,
}: AppleNowPlayingProps) {
  // Merge with defaults
  const opts = { ...DEFAULT_LAYOUT_OPTIONS.apple, ...options };
  const common = useCommonOptions(options as Record<string, unknown> | undefined);

  const isDark = opts.theme === 'dark';
  const baseAlpha = isDark ? 0.75 : 0.85;
  const bgColor = isDark
    ? `rgba(0, 0, 0, ${baseAlpha * common.backgroundOpacity})`
    : `rgba(255, 255, 255, ${baseAlpha * common.backgroundOpacity})`;
  const textColor = isDark ? '#fff' : '#1d1d1f';
  const mutedColor = isDark ? 'rgba(255, 255, 255, 0.6)' : 'rgba(0, 0, 0, 0.5)';
  const progressBg = isDark ? 'rgba(255, 255, 255, 0.2)' : 'rgba(0, 0, 0, 0.1)';
  const blurFilter = buildBlurFilter(common.blurIntensity);
  const shellStyle = {
    background: 'transparent',
  } as const;
  const showProgress = shouldShowPlaybackProgress(playbackProgress);

  // No song playing state
  if (!nowPlaying) {
    return (
      <div
        className="w-full h-full flex flex-col"
        style={shellStyle}
      >
        <div
          className="w-full flex-1 rounded-3xl px-8 py-6 text-center relative overflow-hidden flex flex-col justify-center"
          style={{
            backgroundColor: bgColor,
            backdropFilter: blurFilter,
            WebkitBackdropFilter: blurFilter,
          }}
        >
          <div
            className="w-4 h-4 rounded-full mx-auto mb-4"
            style={{
              backgroundColor: isJoined ? opts.accentColor : connectionStatus === 'disconnected' ? '#EF4444' : '#F59E0B',
              animation: 'pulse 2s ease-in-out infinite',
            }}
          />
          <p style={{ color: mutedColor, fontSize: `${common.scale(14)}px`, fontWeight: 500 }}>
            {connectionStatus === 'disconnected' ? '서버 연결 대기 중...' : isJoined ? '재생 중인 항목 없음' : '연결 중...'}
          </p>
        </div>
      </div>
    );
  }

  return (
    <div
      className="w-full h-full flex flex-col"
      style={shellStyle}
    >
      <div
        className="w-full flex-1 rounded-3xl p-6 relative overflow-hidden flex flex-col justify-center"
        style={{
          backgroundColor: bgColor,
          backdropFilter: blurFilter,
          WebkitBackdropFilter: blurFilter,
        }}
      >
        {/* Blurred album art background */}
        {nowPlaying.albumArt && (
          <div
            className="absolute inset-0 scale-150"
            style={{
              backgroundImage: `url(${nowPlaying.albumArt})`,
              backgroundSize: 'cover',
              backgroundPosition: 'center',
              filter: `blur(${Math.max(common.blurIntensity, 40)}px) saturate(1.5)`,
              opacity: 0.4,
            }}
          />
        )}

        {/* Content overlay */}
        <div
          className="absolute inset-0"
          style={{
            backgroundColor: bgColor,
            backdropFilter: blurFilter,
            WebkitBackdropFilter: blurFilter,
          }}
        />

        {/* Main content */}
        <div className="relative flex items-center">
          <div className="flex items-center gap-5 w-full">
            {/* Album Art - Apple style rounded corners */}
            <div className="flex-shrink-0">
              <div
                className="w-24 h-24 rounded-xl overflow-hidden shadow-xl"
                style={{
                  boxShadow: isDark
                    ? '0 8px 32px rgba(0, 0, 0, 0.5)'
                    : '0 8px 32px rgba(0, 0, 0, 0.15)',
                }}
              >
                {nowPlaying.albumArt ? (
                  <img
                    src={nowPlaying.albumArt}
                    alt="Album Art"
                    className="w-full h-full object-cover"
                  />
                ) : (
                  <div
                    className="w-full h-full flex items-center justify-center"
                    style={{ backgroundColor: isDark ? '#2c2c2e' : '#f2f2f7' }}
                  >
                    <svg
                      className="w-10 h-10"
                      style={{ color: mutedColor }}
                      fill="none"
                      stroke="currentColor"
                      viewBox="0 0 24 24"
                    >
                      <path
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        strokeWidth={1.5}
                        d="M9 19V6l12-3v13M9 19c0 1.105-1.343 2-3 2s-3-.895-3-2 1.343-2 3-2 3 .895 3 2zm12-3c0 1.105-1.343 2-3 2s-3-.895-3-2 1.343-2 3-2 3 .895 3 2zM9 10l12-3"
                      />
                    </svg>
                  </div>
                )}
              </div>
            </div>

            {/* Song Info */}
            <div className="flex-1 min-w-0">
              {/* Badges */}
              <div className="flex items-center gap-2 mb-1">
                {nowPlaying.isDonation && (
                  <span
                    className="px-2 py-0.5 rounded-full font-semibold"
                    style={{
                      backgroundColor: opts.accentColor,
                      color: '#fff',
                      fontSize: `${common.scale(13)}px`,
                    }}
                  >
                    후원곡
                  </span>
                )}
                {nowPlaying.isHomework && (
                  <span
                    className="px-2 py-0.5 rounded-full font-semibold"
                    style={{
                      backgroundColor: '#007AFF',
                      color: '#fff',
                      fontSize: `${common.scale(13)}px`,
                    }}
                  >
                    숙제곡
                  </span>
                )}
              </div>

              {/* Title */}
              <h3
                className="truncate mb-0.5 tracking-tight"
                style={{ color: textColor, fontSize: `${common.scale(28)}px`, fontWeight: 800 }}
              >
                {nowPlaying.title}
              </h3>

              {/* Artist — rendered in Apple red. Always bold-ish (600) and
                 add a subtle text-shadow / semi-transparent dark backing for
                 legibility against light album art. */}
              <p
                className="truncate"
                style={{
                  color: opts.accentColor,
                  fontSize: `${common.scale(21)}px`,
                  fontWeight: 600,
                  textShadow: isDark
                    ? '0 1px 2px rgba(0,0,0,.3)'
                    : '0 1px 2px rgba(255,255,255,.5), 0 0 8px rgba(0,0,0,.18)',
                }}
              >
                {nowPlaying.artist}
              </p>
              {formatAvailableChannels(nowPlaying.availableChannels) && (
                <p
                  className="truncate"
                  style={{
                    color: mutedColor,
                    fontSize: `${common.scale(15)}px`,
                    fontWeight: 500,
                  }}
                >
                  {formatAvailableChannels(nowPlaying.availableChannels)}
                </p>
              )}

              {showProgress && (
                <div className="mt-4">
                  <div
                    className="relative h-1 rounded-full overflow-hidden"
                    style={{ backgroundColor: progressBg }}
                  >
                    <div
                      className={`absolute top-0 left-0 h-full rounded-full${reducedMotion ? '' : ' transition-all duration-300'}`}
                      style={{
                        width: `${Math.min(100, Math.max(0, playbackProgress.percentage))}%`,
                        backgroundColor: opts.accentColor,
                      }}
                    />
                  </div>

                  <div className="flex justify-between mt-1">
                    <span className="font-medium" style={{ color: mutedColor, fontSize: `${common.scale(13)}px` }}>
                      {formatTime(playbackProgress.currentTime)}
                    </span>
                    <span className="font-medium" style={{ color: mutedColor, fontSize: `${common.scale(13)}px` }}>
                      -{formatTime(playbackProgress.duration - playbackProgress.currentTime)}
                    </span>
                  </div>
                </div>
              )}
            </div>

            {/* Connection indicator */}
            <div className="flex-shrink-0">
              <div
                className="w-2 h-2 rounded-full"
                style={{
                  backgroundColor: isJoined ? opts.accentColor : connectionStatus === 'disconnected' ? '#EF4444' : '#F59E0B',
                  boxShadow: isJoined ? `0 0 6px ${opts.accentColor}` : undefined,
                }}
              />
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
NowPlayingApple.displayName = 'NowPlayingApple';
export default memo(NowPlayingApple);
