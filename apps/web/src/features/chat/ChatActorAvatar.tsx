'use client';

import { useLayoutEffect, useState, useSyncExternalStore } from 'react';
import { Avatar, AvatarFallback } from '@/shared/ui/avatar';
import { AvatarPlaceholder } from '@/shared/ui/avatar-placeholder';
import { ScopedMediaImage, useMediaRoomId, useMediaScope } from '@/features/media/session-ui';
import type { MediaImageResource } from '@/features/media/image-resource';
import type { ChatActorRef } from './types';

export function ChatActorAvatar({ actor }: { actor: ChatActorRef }) {
  const roomId = useMediaRoomId();
  return <div className="mt-1 w-8 shrink-0 [&_img]:size-8 [&_img]:rounded-full [&_img]:object-cover">
    {roomId && actor.avatarAssetId
      ? <ScopedMediaImage assetId={actor.avatarAssetId} context={{ variant: 'image', roomId, actorId: actor.actorId }} alt="참여자 프로필 사진" presentation="avatar" />
      : roomId && actor.providerAvatarAvailable
        ? <ProviderActorAvatar key={`${roomId}:${actor.actorId}`} roomId={roomId} actorId={actor.actorId} />
        : <Avatar className="size-8" aria-hidden="true"><AvatarFallback><AvatarPlaceholder /></AvatarFallback></Avatar>}
  </div>;
}

function ProviderActorAvatar({ roomId, actorId }: { roomId: string; actorId: string }) {
  const scope = useMediaScope();
  const [resource, setResource] = useState<MediaImageResource | null>(null);
  useLayoutEffect(() => {
    if (!scope?.lifetime.isCurrent()) return;
    const lease = scope.acquireProviderAvatar(roomId, actorId);
    let active = true;
    queueMicrotask(() => { if (active) setResource(lease.resource); });
    return () => { active = false; lease.release(); };
  }, [scope, roomId, actorId]);
  if (!scope?.lifetime.isCurrent() || resource?.lifetime !== scope.lifetime) return <AvatarPlaceholder />;
  return <ProviderImage resource={resource} roomId={roomId} actorId={actorId} />;
}

function ProviderImage({ resource, roomId, actorId }: { resource: MediaImageResource; roomId: string; actorId: string }) {
  const state = useSyncExternalStore(resource.subscribe, resource.getSnapshot, resource.getSnapshot);
  if (!resource.lifetime.isCurrent()) return <AvatarPlaceholder />;
  if (state.phase === 'ready' && state.objectUrl) {
    // The opaque ticket never reaches DOM/storage; render only revocable memory bytes.
    // eslint-disable-next-line @next/next/no-img-element
    return <img src={state.objectUrl} alt="참여자 프로필 사진" onError={() => resource.clear()} />;
  }
  return <div className="relative size-8"><AvatarPlaceholder />
    {state.phase !== 'loading' && <button type="button" className="absolute inset-0 rounded-full" aria-label="참여자 사진 다시 확인" onClick={() => { void resource.load(actorId, { variant: 'image', roomId, actorId }); }} />}
  </div>;
}
