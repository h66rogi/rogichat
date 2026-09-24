'use client';

import { memo, useMemo, type CSSProperties } from 'react';

import type { ThemeWidgetProps } from '../types';
import type { NowPlayingData, PlaybackProgress } from '../../components/now-playing/types';
import type { SongRequest } from '../../types/overlay';
import NowPlayingApple from '../../components/now-playing/NowPlayingApple';
import { useCommonOptions } from '../shared';

function toNowPlayingData(req: SongRequest | null | undefined): NowPlayingData | null {
  if (!req) return null;
  return {
    id: req.id,
    title: req.song?.title || req.rawTitle || 'Unknown Title',
    artist: req.song?.artist?.name || req.rawArtist || 'Unknown Artist',
    albumArt: req.song?.albumArt,
    isDonation: (req.donationAmount ?? 0) > 0,
    donationAmount: req.donationAmount,
    isHomework: !!req.isHomework,

    isRandom: !!req.isRandom,
    availableChannels: req.availableChannels,
  };
}

const EMPTY_PROGRESS: PlaybackProgress = {
  currentTime: 0,
  duration: 0,
  state: 'unstarted',
  percentage: 0,
};

function NowPlaying(props: ThemeWidgetProps) {
  const nowPlaying = toNowPlayingData(props.data?.nowPlaying ?? null);
  const common = useCommonOptions(props.options);

  // Merge common accentColor onto options so the legacy NowPlayingApple picks
  // up backend overrides (progress bar, artist line, badge etc).
  const mergedOptions = useMemo(() => {
    const o = (props.options ?? {}) as Record<string, unknown>;
    return {
      ...o,
      ...(common.accentColor ? { accentColor: common.accentColor } : {}),
    };
  }, [props.options, common.accentColor]);

  const wrapperStyle: CSSProperties = useMemo(() => ({
    width: '100%',
    height: '100%',
    fontFamily: common.fontFamily,
    fontWeight: common.fontWeight,
    color: common.textColor,
  }), [common]);

  return (
    <div style={wrapperStyle}>
      <NowPlayingApple
        nowPlaying={nowPlaying}
        playbackProgress={props.playbackProgress ?? EMPTY_PROGRESS}
        isConnected={props.connectionStatus === 'connected'}
        isJoined={props.connectionStatus === 'connected'}
        connectionStatus={props.connectionStatus ?? 'connecting'}
        options={mergedOptions}
        reducedMotion={props.reducedMotion}
      />
    </div>
  );
}
NowPlaying.displayName = 'NowPlaying';
export default memo(NowPlaying);
