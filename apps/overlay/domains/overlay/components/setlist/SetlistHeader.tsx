'use client';

import { memo } from 'react';
import type { SongRequest } from '@/domains/overlay/types/overlay';

interface SetlistHeaderProps {
  requestEnabled: boolean;
  paused: boolean;
  donationEnabled: boolean;
  setlist: SongRequest[];
  /** @deprecated rotation 제거됨. 호환성 유지를 위해 prop만 남겨둠. */
  rotationIntervalMs?: number;
  /** 신청방법 안내 섹션 표시 여부. 기본 true. */
  showRequestMethods?: boolean;
  className?: string;
}

interface RequestMethodBadge {
  label?: string;
  body: string;
}

function buildBadges(donationEnabled: boolean): RequestMethodBadge[] {
  return [
    {
      label: donationEnabled ? '채팅/후원' : '채팅',
      body: '!신청 가수 - 노래제목',
    },
    {
      body: '멜로밍 사이트/앱에서 신청',
    },
  ];
}

function SetlistHeader({
  requestEnabled,
  paused,
  donationEnabled,
  setlist,
  showRequestMethods = true,
  className,
}: SetlistHeaderProps) {
  const completedCount = setlist.filter((s) => s.status === 'COMPLETED').length;
  const totalCount = setlist.length;
  const isPaused = !requestEnabled || paused;
  const badges = buildBadges(donationEnabled);

  return (
    <div className={className}>
      <div className="flex min-w-0 flex-1 flex-col gap-1">
        {isPaused ? (
          <span className="opacity-80">신청 일시정지</span>
        ) : showRequestMethods ? (
          <>
            <div
              style={{
                fontSize: '0.7em',
                opacity: 0.55,
                letterSpacing: 0.6,
                lineHeight: 1.2,
              }}
            >
              신청방법
            </div>
            <div
              className="flex flex-wrap items-start gap-1.5"
              style={{ fontSize: '0.85em', lineHeight: 1.45 }}
            >
              {badges.map((b, i) => (
                <span
                  key={i}
                  className="rounded-md bg-current/10 px-2 py-0.5"
                  style={{
                    // keep-all 은 한글 어절을 깨지 않고, break-word 는 너무
                    // 긴 단어가 컨테이너 폭을 넘어가는 경우의 안전장치.
                    // maxWidth 100% 로 뱃지가 부모 폭을 절대 넘지 않도록 고정.
                    wordBreak: 'keep-all',
                    overflowWrap: 'break-word',
                    maxWidth: '100%',
                  }}
                >
                  {b.label ? (
                    <>
                      <span className="font-semibold opacity-90">{b.label}</span>
                      <span className="opacity-75">{` : ${b.body}`}</span>
                    </>
                  ) : (
                    <span className="opacity-85">{b.body}</span>
                  )}
                </span>
              ))}
            </div>
          </>
        ) : null}
      </div>
      <div className="shrink-0">
        {completedCount} / {totalCount}
      </div>
    </div>
  );
}
SetlistHeader.displayName = 'SetlistHeader';
const MemoizedSetlistHeader = memo(SetlistHeader);
export { MemoizedSetlistHeader as SetlistHeader };
