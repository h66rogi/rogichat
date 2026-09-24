import 'server-only';
import { randomUUID } from 'node:crypto';
import { runtimeConfig } from '@/core/runtime/config';
import { resolveDefaultRoom } from '@/core/api/default-room';
import { parseSession, sessionAllowsChat } from '@/core/api/session-contract';
import type { Room } from '@/core/api/client';
import { actor, cursor, envelope, exact, list, membership, message, record, token, uuid, type RoomMembership, type ServerMessage } from '@/features/chat/contract';
import type { ChatActorRef } from '@/features/chat/types';
import { serverSessionCredential } from './private-bootstrap';

export interface ChatSeed {
  sessionBinding: string;
  accountPartition: string;
  room: RoomMembership;
  profiles: ChatActorRef[];
  recipients: ChatActorRef[];
  messages: ServerMessage[];
  eventCursor: string;
  historyCursor: string | null;
  manifestGeneration: string;
  profileGeneration: string;
  deviceId: string;
  cacheId: string;
}
export type ChannelBootstrap = { sessionBinding: string; accountPartition: string; room: Room | null; chat: ChatSeed | null };

/** Request scoped, validated and uncached. A failed read falls back to the live client retry path. */
export async function loadChannelBootstrap(): Promise<ChannelBootstrap | null> {
  const credential = await serverSessionCredential();
  if (!credential) return null;
  const config = runtimeConfig();
  const read = async (path: string): Promise<unknown> => {
    const response = await fetch(config.apiOrigin + path, { cache: 'no-store', redirect: 'error', signal: AbortSignal.timeout(8000),
      headers: { accept: 'application/json', cookie: `${credential.name}=${credential.token}` } });
    if (!response.ok || !response.headers.get('content-type')?.includes('application/json')) throw new Error('CHANNEL_BOOTSTRAP_UNAVAILABLE');
    return response.json();
  };
  try {
    const [sessionValue, room] = await Promise.all([read('/v1/auth/session'), resolveDefaultRoom(read, config.defaultRoomId)]);
    const session = parseSession(sessionValue);
    if (!sessionAllowsChat(session)) return null;
    if (!room || !room.joined || room.availability === 'OWNER_PENDING') return { sessionBinding: session.csrfToken, accountPartition: session.accountPartition, room, chat: null };
    const deviceId = randomUUID(), cacheId = randomUUID();
    const query = `?${new URLSearchParams({ deviceId, cacheId, limit: '100' })}`;
    const sync = envelope(await read(`/v1/sync${query}`), 'manifest');
    if (sync.resetRequired || sync.nextCursor !== null) return { sessionBinding: session.csrfToken, accountPartition: session.accountPartition, room, chat: null };
    const accessRow = list(sync.rooms).find(value => record(value).roomId === room.roomId);
    const access = accessRow ? membership(accessRow) : null;
    if (!access) return { sessionBinding: session.csrfToken, accountPartition: session.accountPartition, room, chat: null };
    const prefix = `/v1/rooms/${encodeURIComponent(room.roomId)}`;
    const [profilesValue, recipientValue, snapshotValue] = await Promise.all([
      read(`${prefix}/profile-sync${query}`), read(`${prefix}/private-recipients`), read(`${prefix}/snapshot${query}`),
    ]);
    const profilesPage = envelope(profilesValue, 'profiles');
    if (profilesPage.resetRequired || profilesPage.nextCursor !== null || profilesPage.membershipScope !== access.membershipScope || profilesPage.authorizationRevision !== access.authorizationRevision) return { sessionBinding: session.csrfToken, accountPartition: session.accountPartition, room, chat: null };
    const profiles = list(profilesPage.profiles).map(actor).filter((item): item is ChatActorRef => item !== null);
    const recipientPage = exact(recipientValue, ['recipients', 'next']);
    if (recipientPage.next !== null) return { sessionBinding: session.csrfToken, accountPartition: session.accountPartition, room, chat: null };
    const recipients = list(recipientPage.recipients).map(value => {
      const data = exact(value, ['actorId', 'nickname', 'avatar']);
      const actorId = uuid(data.actorId);
      if (data.avatar !== null) uuid(exact(data.avatar, ['assetId']).assetId);
      if (actorId === access.actorId || typeof data.nickname !== 'string') throw new Error('INVALID_RECIPIENT');
      return { actorId, displayName: data.nickname, avatarUrl: null, role: profiles.find(profile => profile.actorId === actorId)?.role };
    });
    const snapshot = envelope(snapshotValue, 'snapshot');
    if (snapshot.resetRequired || snapshot.membershipScope !== access.membershipScope || snapshot.authorizationRevision !== access.authorizationRevision) return { sessionBinding: session.csrfToken, accountPartition: session.accountPartition, room, chat: null };
    const confirmed = parseSession(await read('/v1/auth/session'));
    if (!sessionAllowsChat(confirmed) || confirmed.csrfToken !== session.csrfToken || confirmed.accountPartition !== session.accountPartition) return null;
    const seed: ChatSeed = { sessionBinding: confirmed.csrfToken, accountPartition: token(confirmed.accountPartition), room: access, profiles, recipients,
      messages: list(snapshot.messages).map(message), eventCursor: String(snapshot.nextCursor), historyCursor: cursor(snapshot.historyCursor),
      manifestGeneration: String(sync.generation), profileGeneration: String(profilesPage.generation), deviceId, cacheId };
    return { sessionBinding: confirmed.csrfToken, accountPartition: confirmed.accountPartition, room, chat: seed };
  } catch { return null; }
}
