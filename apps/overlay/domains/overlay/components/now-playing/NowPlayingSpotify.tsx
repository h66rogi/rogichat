'use client';

import { memo } from 'react';

import { NowPlayingProps, formatTime, shouldShowPlaybackProgress } from './types';
import { SpotifyLayoutOptions, DEFAULT_LAYOUT_OPTIONS } from '@/domains/overlay/types/options';
import { useCommonOptions } from '@/domains/overlay/themes/shared/use-common-options';
import { hexToRgba, buildBlurFilter } from '@/domains/overlay/themes/shared/apply-transparency';

interface SpotifyNowPlayingProps extends NowPlayingProps {
  options?: Partial<SpotifyLayoutOptions>;
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

const ALBUM_SIZES = {
  small: 'w-16 h-16',
  medium: 'w-24 h-24',
  large: 'w-32 h-32',
};

function NowPlayingSpotify({
  nowPlaying,
  playbackProgress,
  isJoined,
  connectionStatus,
  options,
  reducedMotion,
}: SpotifyNowPlayingProps) {
  // Merge with defaults
  const opts = { ...DEFAULT_LAYOUT_OPTIONS.spotify, ...options };
  const common = useCommonOptions(options as Record<string, unknown> | undefined);

  const bgWithOpacity = hexToRgba(opts.backgroundColor, common.backgroundOpacity);
  const blurFilter = buildBlurFilter(common.blurIntensity);
  const shellStyle = {
    background: 'transparent',
  } as const;
  const showProgress = shouldShowPlaybackProgress(playbackProgress);
  const clampedPct = Math.min(100, Math.max(0, playbackProgress.percentage));

  // No song playing state
  if (!nowPlaying) {
    return (
      <div
        className="w-full h-full flex flex-col"
        style={shellStyle}
      >
        <div
          className="w-full flex-1 rounded-2xl px-8 py-6 text-center flex flex-col justify-center"
          style={{
            backgroundColor: bgWithOpacity,
            backdropFilter: blurFilter,
            WebkitBackdropFilter: blurFilter,
          }}
        >
          <div
            className="w-4 h-4 rounded-full mx-auto mb-4"
            style={{
              backgroundColor: isJoined ? opts.progressBarColor : connectionStatus === 'disconnected' ? '#EF4444' : '#F59E0B',
              animation: 'pulse 2s ease-in-out infinite',
            }}
          />
          <p className="text-gray-400" style={{ fontSize: `${common.scale(14)}px` }}>
            {connectionStatus === 'disconnected' ? '서버 연결 대기 중...' : isJoined ? '재생 중인 곡이 없습니다' : '연결 중...'}
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
        className="w-full flex-1 rounded-2xl p-6 flex flex-col justify-center"
        style={{
          backgroundColor: bgWithOpacity,
          backdropFilter: blurFilter,
          WebkitBackdropFilter: blurFilter,
        }}
      >
        <div className="flex items-center gap-5 w-full">
          {/* Album Art */}
          <div className={`flex-shrink-0 ${ALBUM_SIZES[opts.albumArtSize]} rounded shadow-lg overflow-hidden`}>
            {nowPlaying.albumArt ? (
              <img
                src={nowPlaying.albumArt}
                alt="Album Art"
                className="w-full h-full object-cover"
              />
            ) : (
              <div
                className="w-full h-full flex items-center justify-center"
                style={{ backgroundColor: '#282828' }}
              >
                <svg
                  className="w-8 h-8 text-gray-500"
                  fill="none"
                  stroke="currentColor"
                  viewBox="0 0 24 24"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M9 19V6l12-3v13M9 19c0 1.105-1.343 2-3 2s-3-.895-3-2 1.343-2 3-2 3 .895 3 2zm12-3c0 1.105-1.343 2-3 2s-3-.895-3-2 1.343-2 3-2 3 .895 3 2zM9 10l12-3"
                  />
                </svg>
              </div>
            )}
          </div>

          {/* Song Info & Progress */}
          <div className="flex-1 min-w-0">
            {/* Badges */}
            <div className="flex items-center gap-2 mb-1">
              {nowPlaying.isDonation && (
                <span
                  className="px-2 py-0.5 rounded-full font-medium uppercase"
                  style={{
                    backgroundColor: opts.progressBarColor,
                    color: '#000',
                    fontSize: `${common.scale(13)}px`,
                  }}
                >
                  후원곡
                </span>
              )}
              {nowPlaying.isHomework && (
                <span
                  className="px-2 py-0.5 rounded-full font-medium uppercase bg-blue-500 text-white"
                  style={{ fontSize: `${common.scale(13)}px` }}
                >
                  숙제곡
                </span>
              )}
            </div>

            {/* Title */}
            <h3 className="text-white truncate mb-0.5" style={{ fontSize: `${common.scale(28)}px`, fontWeight: 700 }}>
              {nowPlaying.title}
            </h3>

            {/* Artist */}
            <p className="text-gray-400 truncate" style={{ fontSize: `${common.scale(19)}px` }}>{nowPlaying.artist}</p>
            {formatAvailableChannels(nowPlaying.availableChannels) && (
              <p className="text-gray-500 truncate" style={{ fontSize: `${common.scale(15)}px` }}>
                {formatAvailableChannels(nowPlaying.availableChannels)}
              </p>
            )}

            {showProgress && (
              <div className="mt-4">
                <div className="relative h-1 rounded-full bg-gray-600 overflow-hidden group">
                  <div
                    className={`absolute top-0 left-0 h-full rounded-full${reducedMotion ? '' : ' transition-all duration-300'}`}
                    style={{
                      width: `${clampedPct}%`,
                      backgroundColor: opts.progressBarColor,
                    }}
                  />
                  <div
                    className="absolute top-1/2 -translate-y-1/2 w-3 h-3 rounded-full shadow-md"
                    style={{
                      left: `calc(${clampedPct}% - 6px)`,
                      backgroundColor: '#fff',
                    }}
                  />
                </div>

                <div className="flex justify-between mt-1">
                  <span className="text-gray-400" style={{ fontSize: `${common.scale(13)}px` }}>
                    {formatTime(playbackProgress.currentTime)}
                  </span>
                  <span className="text-gray-400" style={{ fontSize: `${common.scale(13)}px` }}>
                    {formatTime(playbackProgress.duration)}
                  </span>
                </div>
              </div>
            )}
          </div>

          {/* Spotify Logo / Connection indicator */}
          <div className="flex-shrink-0 flex flex-col items-center gap-2">
            <div
              className="w-2 h-2 rounded-full"
              style={{
                backgroundColor: isJoined ? opts.progressBarColor : connectionStatus === 'disconnected' ? '#EF4444' : '#F59E0B',
                boxShadow: isJoined ? `0 0 8px ${opts.progressBarColor}` : undefined,
              }}
            />
          </div>
        </div>
      </div>
    </div>
  );
}
NowPlayingSpotify.displayName = 'NowPlayingSpotify';
export default memo(NowPlayingSpotify);
