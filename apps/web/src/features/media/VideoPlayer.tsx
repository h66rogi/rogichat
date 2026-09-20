'use client';

import { useEffect, useRef, useSyncExternalStore } from 'react';
import type { MediaLifetime } from './contracts';
import type { VideoContext } from './video-client';
import type { MediaVideoResource } from './video-resource';
import { videoReferenceKey } from './video-client';

/** Owner supplies an exact reference lifetime, including message revision/deletion. */
export function VideoPlayer({ resource, lifetime, assetId, context, revision }: {
  resource: MediaVideoResource; lifetime: MediaLifetime; assetId: string; context: VideoContext; revision: string;
}) {
  const element = useRef<HTMLVideoElement>(null);
  const state = useSyncExternalStore(resource.subscribe, resource.getSnapshot, resource.getSnapshot);
  const key = videoReferenceKey(assetId, context, revision);
  useEffect(() => {
    if (element.current) resource.attach(element.current);
    const observer = new IntersectionObserver(entries => {
      if (entries.some(entry => !entry.isIntersecting)) resource.suspend();
    });
    const parent = element.current?.parentElement;
    if (parent) observer.observe(parent);
    return () => { observer.disconnect(); resource.detach(); };
  }, [resource, key]);
  if (resource.lifetime !== lifetime || lifetime.signal.aborted || !lifetime.isCurrent()) return null;
  const phase = state.referenceKey === key ? state.phase : 'empty';
  return <section aria-label="첨부 영상" className="space-y-2">
    <video key={key} ref={element} controls playsInline preload="metadata" aria-label="첨부 영상 재생"
      className="max-h-96 max-w-full rounded-sm" hidden={phase !== 'ready'}
      onError={resource.playbackFailed} />
    {phase !== 'ready' && <p role="status">{phase === 'loading' ? '영상을 불러오고 있습니다.' :
      phase === 'unsupported' ? '이 브라우저에서 영상 형식을 재생할 수 없습니다.' :
      phase === 'expired' ? '이어서 보려면 영상을 다시 불러와 주세요.' :
      phase === 'unavailable' ? '영상을 불러올 수 없습니다. 다시 시도해 주세요.' : '영상을 보려면 불러오기를 눌러 주세요.'}</p>}
    {phase !== 'ready' && phase !== 'loading' && phase !== 'unsupported' &&
      <button type="button" className="min-h-11 rounded-sm border px-4" onClick={() => { void resource.load(assetId, context, revision, true); }}>
        {phase === 'unavailable' ? '다시 불러오기' : '영상 불러오기'}
      </button>}
  </section>;
}
