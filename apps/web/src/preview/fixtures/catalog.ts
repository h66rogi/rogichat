/**
 * Synthetic preview catalog: identities and rooms used ONLY by the QA `/preview` screens.
 *
 * Every identifier carries the marker below. `tools/web/check-preview-isolation.mjs` fails a production
 * build if the marker appears anywhere in the server, client or standalone output, and requires it in the
 * QA build. Nothing here is a server contract, a session, or an authorization decision.
 */
export const PREVIEW_FIXTURE_MARKER = 'rogichat-preview-fixture-7f415df1';

export type PreviewRole = 'fan' | 'streamer';

export interface PreviewActor {
  actorId: string;
  displayName: string;
  role: PreviewRole;
}

export interface PreviewRoom {
  roomId: string;
  title: string;
  /** The streamer who owns the room. Only this actor may receive fan PRIVATE messages in this room. */
  ownerActorId: string;
  /** Fans the room owner is authorised to reply to privately. Synthetic; never derived from messages. */
  authorizedFanActorIds: readonly string[];
}

const id = (suffix: string) => `${PREVIEW_FIXTURE_MARKER}:${suffix}`;

export const previewActors = {
  streamerHurogi: { actorId: id('streamer-hurogi'), displayName: '후로기 (샘플)', role: 'streamer' },
  streamerOther: { actorId: id('streamer-other'), displayName: '다른 스트리머 (샘플)', role: 'streamer' },
  fanA: { actorId: id('fan-a'), displayName: '팬 A (샘플)', role: 'fan' },
  fanB: { actorId: id('fan-b'), displayName: '팬 B (샘플)', role: 'fan' },
} as const satisfies Record<string, PreviewActor>;

export const previewRooms = {
  hurogi: {
    roomId: id('room-hurogi'),
    title: '후로기 채팅방 (샘플)',
    ownerActorId: previewActors.streamerHurogi.actorId,
    authorizedFanActorIds: [previewActors.fanA.actorId, previewActors.fanB.actorId],
  },
  other: {
    roomId: id('room-other'),
    title: '다른 채널 채팅방 (샘플)',
    ownerActorId: previewActors.streamerOther.actorId,
    authorizedFanActorIds: [previewActors.fanB.actorId],
  },
} as const satisfies Record<string, PreviewRoom>;

export type PreviewRoomKey = keyof typeof previewRooms;

export function isPreviewRoomKey(value: string | undefined): value is PreviewRoomKey {
  return value === 'hurogi' || value === 'other';
}

/** Opaque "this room as seen by this viewer" key the preview supplies to the chat presentation. */
export function previewConversationScopeKey(role: PreviewRole, room: PreviewRoom): string {
  const viewerId = role === 'fan' ? previewActors.fanA.actorId : room.ownerActorId;
  return `${room.roomId}:${viewerId}`;
}
