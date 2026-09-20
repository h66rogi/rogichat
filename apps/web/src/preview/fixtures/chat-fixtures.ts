import type { ChatActorRef, ChatTimelineItem } from '@/features/chat';
import { previewActors, type PreviewActor, type PreviewRole, type PreviewRoom } from './catalog';

/**
 * Synthetic timelines for the QA chat previews. Everything is derived from the catalog so a room switch
 * changes the owner, the authorised fans and the items together; nothing is shared between rooms.
 * Fans see SHARED items plus their own PRIVATE conversation only. Timestamps are fixed so date
 * separators render deterministically.
 */
export function toActorRef(actor: PreviewActor): ChatActorRef {
  return {
    actorId: actor.actorId,
    displayName: actor.displayName,
    avatarUrl: null,
    role: actor.role === 'fan' ? 'FAN' : 'STREAMER',
  };
}

const LONG_BODY =
  '오늘 방송 정말 잘 봤어요. 특히 마지막 노래에서 고음 올라갈 때 소름 돋았습니다. 다음 방송에서는 지난번에 신청했던 곡도 들을 수 있을까요? 긴 메시지가 여러 줄로 어떻게 보이는지 확인하기 위한 샘플 문장입니다. 줄바꿈 없이 길게 이어지는 본문이 타임라인 폭 안에서 자연스럽게 접히는지 봅니다.';

export function buildPreviewTimeline(role: PreviewRole, room: PreviewRoom): ChatTimelineItem[] {
  const owner = toActorRef(actorById(room.ownerActorId));
  const viewerFan = toActorRef(previewActors.fanA);
  const fanA = toActorRef(previewActors.fanA);
  const fanB = toActorRef(previewActors.fanB);
  const prefix = room.roomId;
  const sample = { isPreviewSample: true } as const;

  const sharedFromOwner = (id: string, body: string, createdAt: string, isOwn: boolean): ChatTimelineItem => ({
    kind: 'message',
    id: `${prefix}:${id}`,
    scope: 'SHARED',
    author: owner,
    isOwn,
    body,
    createdAt,
    status: 'saved',
    ...sample,
  });

  if (role === 'fan') {
    return [
      sharedFromOwner('s1', `${owner.displayName}입니다. 오늘 방송 봐 줘서 고마워요.`, '2026-09-19T12:00:00+09:00', false),
      {
        kind: 'message',
        id: `${prefix}:p1`,
        scope: 'PRIVATE',
        author: viewerFan,
        recipient: owner,
        isOwn: true,
        body: LONG_BODY,
        createdAt: '2026-09-19T12:05:00+09:00',
        status: 'saved',
        ...sample,
      },
      {
        kind: 'message',
        id: `${prefix}:p2`,
        scope: 'PRIVATE',
        author: owner,
        recipient: viewerFan,
        isOwn: false,
        body: '신청곡은 다음 방송 후반에 준비해 볼게요.',
        createdAt: '2026-09-19T12:30:00+09:00',
        status: 'saved',
        quote: { messageId: `${prefix}:p1`, authorName: viewerFan.displayName, excerpt: '지난번에 신청했던 곡도 들을 수 있을까요?' },
        ...sample,
      },
      { kind: 'publication', id: `${prefix}:pub1`, body: '다음 방송에서 신청곡 코너를 해 달라는 요청이 있었어요. 준비해 볼게요.', createdAt: '2026-09-19T13:00:00+09:00' },
      { kind: 'unsupported', id: `${prefix}:u1`, scope: 'SHARED', createdAt: '2026-09-20T09:00:00+09:00' },
      sharedFromOwner('s2', '오늘 방송은 저녁 8시에 시작해요.', '2026-09-20T09:10:00+09:00', false),
      {
        kind: 'message',
        id: `${prefix}:p3`,
        scope: 'PRIVATE',
        author: viewerFan,
        recipient: owner,
        isOwn: true,
        body: '',
        createdAt: '2026-09-20T09:20:00+09:00',
        status: 'deleted',
        ...sample,
      },
      {
        kind: 'message',
        id: `${prefix}:p4`,
        scope: 'PRIVATE',
        author: viewerFan,
        recipient: owner,
        isOwn: true,
        body: '이 메시지는 전송 결과를 아직 확인하지 못한 상태예요.',
        createdAt: '2026-09-20T09:25:00+09:00',
        status: 'unknown',
        statusNote: '결과 확인 중',
        ...sample,
      },
      {
        kind: 'message',
        id: `${prefix}:p5`,
        scope: 'PRIVATE',
        author: viewerFan,
        recipient: owner,
        isOwn: true,
        body: '이 메시지는 서버가 거부한 예시예요.',
        createdAt: '2026-09-20T09:26:00+09:00',
        status: 'rejected',
        statusNote: '지금은 보낼 수 없는 대상이에요. 수정한 뒤 다시 보낼 수 있어요.',
        ...sample,
      },
    ];
  }

  const authorizedFans = room.authorizedFanActorIds.map((actorId) => toActorRef(actorById(actorId)));
  const firstFan = authorizedFans[0] ?? fanA;
  const secondFan = authorizedFans[1] ?? fanB;
  return [
    sharedFromOwner('s1', '오늘 방송 봐 줘서 고마워요.', '2026-09-19T12:00:00+09:00', true),
    {
      kind: 'message',
      id: `${prefix}:f1`,
      scope: 'PRIVATE',
      author: firstFan,
      recipient: owner,
      isOwn: false,
      body: LONG_BODY,
      createdAt: '2026-09-19T12:05:00+09:00',
      status: 'saved',
      ...sample,
    },
    {
      kind: 'message',
      id: `${prefix}:r1`,
      scope: 'PRIVATE',
      author: owner,
      recipient: firstFan,
      isOwn: true,
      body: '신청곡은 다음 방송 후반에 준비해 볼게요.',
      createdAt: '2026-09-19T12:30:00+09:00',
      status: 'saved',
      quote: { messageId: `${prefix}:f1`, authorName: firstFan.displayName, excerpt: '지난번에 신청했던 곡도 들을 수 있을까요?' },
      ...sample,
    },
    // The synthetic array is kept in chronological order; the timeline never sorts by id.
    { kind: 'publication', id: `${prefix}:pub1`, body: '다음 방송에서 신청곡 코너를 해 달라는 요청이 있었어요. 준비해 볼게요.', createdAt: '2026-09-19T13:00:00+09:00' },
    ...(authorizedFans.length > 1
      ? [
          {
            kind: 'message',
            id: `${prefix}:f2`,
            scope: 'PRIVATE',
            author: secondFan,
            recipient: owner,
            isOwn: false,
            body: '방송 시작 알림은 어디서 받을 수 있나요?',
            createdAt: '2026-09-19T14:00:00+09:00',
            status: 'saved',
            ...sample,
          } satisfies ChatTimelineItem,
        ]
      : []),
    { kind: 'unsupported', id: `${prefix}:u1`, scope: 'PRIVATE', createdAt: '2026-09-20T09:00:00+09:00' },
    sharedFromOwner('s2', '오늘 방송은 저녁 8시에 시작해요.', '2026-09-20T09:10:00+09:00', true),
    {
      kind: 'message',
      id: `${prefix}:r2`,
      scope: 'SHARED',
      author: owner,
      isOwn: true,
      body: '',
      createdAt: '2026-09-20T09:20:00+09:00',
      status: 'deleted',
      ...sample,
    },
  ];
}

function actorById(actorId: string): PreviewActor {
  const actor = Object.values(previewActors).find((candidate) => candidate.actorId === actorId);
  if (!actor) throw new Error('Unknown preview actor');
  return actor;
}
