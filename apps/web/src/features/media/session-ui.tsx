'use client';

import { createContext, useContext, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { useApi, useMediaStorageOrigins } from '@/core/runtime/provider';
import { invalidateSession } from '@/features/auth/private-session';
import { AuthorizedMediaImage } from './components';
import { imageReferenceKey, type ImageContext, type MediaLifetime } from './contracts';
import { MediaImageResource } from './image-resource';
import { MediaSessionScope } from './session-scope';
import { MediaUpload } from './upload';
import { MediaVideoResource } from './video-resource';
import { VideoPlayer } from './VideoPlayer';
import { videoReferenceKey, type VideoContext } from './video-client';

const MediaContext = createContext<MediaSessionScope | null>(null);
const MediaRoomContext = createContext<string | null>(null);
export const useMediaScope = () => useContext(MediaContext);
export const useMediaRoomId = () => useContext(MediaRoomContext);

export function SessionMediaProvider({ csrf, lifetime, roomId, children }: { csrf: string; lifetime?: MediaLifetime; roomId?: string; children: ReactNode }) {
  const api = useApi(); const origins = useMediaStorageOrigins();
  const [scope, setScope] = useState<MediaSessionScope | null>(null);
  useLayoutEffect(() => {
    const current = new MediaSessionScope(api, csrf, origins, invalidateSession, lifetime);
    // Every effect setup owns new resources, including React Strict Mode replay.
    queueMicrotask(() => { if (!current.lifetime.signal.aborted) setScope(current); });
    return current.dispose;
  }, [api, csrf, origins, lifetime]);
  return <MediaContext.Provider value={scope?.lifetime.isCurrent() ? scope : null}><MediaRoomContext.Provider value={roomId ?? null}>{children}</MediaRoomContext.Provider></MediaContext.Provider>;
}

export function useMediaUpload() {
  const scope = useMediaScope();
  const [upload, setUpload] = useState<MediaUpload | null>(null);
  useLayoutEffect(() => {
    if (!scope?.configured) return;
    const current = new MediaUpload(scope.client);
    let active = true;
    queueMicrotask(() => { if (active) setUpload(current); });
    return () => { active = false; current.dispose(); };
  }, [scope]);
  return scope?.configured && upload?.lifetime === scope.lifetime ? upload : null;
}

export function ScopedMediaImage(props: { assetId: string; context: ImageContext; alt: string; revision?: string }) {
  return <ReferenceImage key={JSON.stringify([imageReferenceKey(props.assetId, props.context), props.revision])} {...props} />;
}
function ReferenceImage({ assetId, context, alt }: { assetId: string; context: ImageContext; alt: string }) {
  const scope = useMediaScope();
  const [reference] = useState(context);
  const container = useRef<HTMLDivElement>(null);
  const [visible, setVisible] = useState(false);
  useLayoutEffect(() => {
    const observer = new IntersectionObserver(entries => setVisible(entries.some(entry => entry.isIntersecting)));
    if (container.current) observer.observe(container.current);
    return () => observer.disconnect();
  }, []);
  const [resource, setResource] = useState<MediaImageResource | null>(null);
  useLayoutEffect(() => {
    if (!scope?.configured || !visible) return;
    const current = new MediaImageResource(scope.client);
    let active = true;
    queueMicrotask(() => { if (active) setResource(current); });
    return () => { active = false; current.dispose(); };
  }, [scope, visible]);
  return <div ref={container} className="min-h-12">{visible && scope?.configured && resource?.lifetime === scope.lifetime
    ? <AuthorizedMediaImage resource={resource} lifetime={scope.lifetime} assetId={assetId} context={reference} alt={alt} />
    : <p role="status">{visible ? '지금은 이미지를 표시할 수 없습니다.' : '이미지'}</p>}</div>;
}


export function ScopedMediaVideo(props: { assetId: string; context: VideoContext; revision: string }) {
  return <ReferenceVideo key={videoReferenceKey(props.assetId, props.context, props.revision)} {...props} />;
}
function ReferenceVideo({ assetId, context, revision }: { assetId: string; context: VideoContext; revision: string }) {
  const scope = useMediaScope(); const [reference] = useState(context);
  const [resource, setResource] = useState<MediaVideoResource | null>(null);
  useLayoutEffect(() => {
    if (!scope?.configured) return;
    const abort = new AbortController();
    const lifetime = { signal: AbortSignal.any([abort.signal, scope.lifetime.signal]), isCurrent: () => !abort.signal.aborted && scope.lifetime.isCurrent() };
    const current = new MediaVideoResource(scope.videoClient(lifetime));
    queueMicrotask(() => { if (!lifetime.signal.aborted) setResource(current); });
    return () => { abort.abort(); current.dispose(); };
  }, [scope]);
  if (!scope?.configured || !resource || !resource.lifetime.isCurrent()) return <p role="status">지금은 영상을 표시할 수 없습니다.</p>;
  return <VideoPlayer resource={resource} lifetime={resource.lifetime} assetId={assetId} context={reference} revision={revision} />;
}
