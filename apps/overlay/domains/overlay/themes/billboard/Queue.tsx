'use client';

import { memo, useMemo, type CSSProperties } from 'react';

import type { ThemeWidgetProps } from '../types';
import type { SongRequest } from '../../types/overlay';
import { QueueWidgetView, type QueueItem } from '../../components/queue/QueueWidgetView';
import { useCommonOptions, resolveTextStroke, buildTextStrokeStyle } from '../shared';

function toQueueItems(requests: SongRequest[]): QueueItem[] {
  return requests.map((req, index) => ({
    id: req.id,
    title: req.song?.title || req.rawTitle || 'Unknown Title',
    artist: req.song?.artist?.name || req.rawArtist || 'Unknown Artist',
    requester: req.requesterNickname || '',
    position: req.queueOrder ?? index + 1,
    isDonation: (req.donationAmount ?? 0) > 0,
    donationAmount: req.donationAmount,
    isHomework: !!req.isHomework,

    isRandom: !!req.isRandom,
    albumArt: req.song?.albumArt,
    availableChannels: req.availableChannels,
  }));
}

function Queue(props: ThemeWidgetProps) {
  const queue = toQueueItems(props.data?.queue ?? []);
  const common = useCommonOptions(props.options);

  const mergedOptions = useMemo(() => {
    const o = (props.options ?? {}) as Record<string, unknown>;
    return {
      ...o,
      ...(common.textColor ? { textColor: common.textColor } : {}),
      ...(common.accentColor ? { accentColor: common.accentColor } : {}),
    };
  }, [props.options, common.textColor, common.accentColor]);

  const stroke = useMemo(
    () => resolveTextStroke(props.options as Record<string, unknown> | undefined),
    [props.options],
  );
  const strokeStyle = useMemo(() => buildTextStrokeStyle(stroke), [stroke]);

  const wrapperStyle: CSSProperties = useMemo(() => ({
    width: '100%',
    height: '100%',
    fontFamily: common.fontFamily,
    fontWeight: common.fontWeight,
    color: common.textColor,
    ...strokeStyle,
  }), [common, strokeStyle]);

  return (
    <div style={wrapperStyle}>
      <QueueWidgetView
        layoutType="billboard"
        options={mergedOptions}
        queue={queue}
        omakase={props.data?.omakase ?? null}
        isSessionLive={props.data?.isLive ?? false}
        isJoined={props.connectionStatus === 'connected'}
        connectionStatus={props.connectionStatus ?? 'connecting'}
      />
    </div>
  );
}
Queue.displayName = 'Queue';
export default memo(Queue);
