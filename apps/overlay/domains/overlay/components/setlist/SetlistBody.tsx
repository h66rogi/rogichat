'use client';

import type { SongRequest } from '@/domains/overlay/types/overlay';
import { Fragment, memo } from 'react';

interface SetlistBodyProps {
  setlist: SongRequest[];
  separator?: string;
  completedOpacity?: number;
  donationColor?: string;
  className?: string;
}

function SetlistBody({
  setlist,
  separator = ' / ',
  completedOpacity = 0.35,
  donationColor = '#fbbf24',
  className,
}: SetlistBodyProps) {
  // Exclude PLAYING (shown in NowPlaying) and REJECTED (hidden)
  const visibleItems = setlist.filter(
    (s) => s.status !== 'PLAYING' && s.status !== 'REJECTED'
  );

  return (
    <div className={className} style={{ textAlign: 'center' }}>
      {visibleItems.map((item, i) => {
        const title = item.song?.title ?? item.rawTitle;
        const isCompleted = item.status === 'COMPLETED';
        const isDonation = (item.donationAmount ?? 0) > 0;
        const priceText = item.formattedPrice ?? item.donationAmount?.toLocaleString('ko-KR');

        return (
          <Fragment key={item.id}>
            {i > 0 && <span style={{ opacity: completedOpacity }}>{separator}</span>}
            <span
              style={{
                textDecoration: isCompleted ? 'line-through' : 'none',
                opacity: isCompleted ? completedOpacity : 1,
                fontWeight: 700,
              }}
            >
              {title}
            </span>
            {isDonation && !isCompleted && (
              <span style={{ fontSize: '1em', color: donationColor, marginLeft: '4px' }}>
                🎁{priceText}
              </span>
            )}
          </Fragment>
        );
      })}
    </div>
  );
}
SetlistBody.displayName = 'SetlistBody';
const MemoizedSetlistBody = memo(SetlistBody);
export { MemoizedSetlistBody as SetlistBody };
