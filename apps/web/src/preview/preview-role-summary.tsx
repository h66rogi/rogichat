import { Badge } from '@/shared/ui/badge';
import { previewActors, previewRooms, type PreviewActor, type PreviewRoom, type PreviewRole } from './fixtures/catalog';

/**
 * States, from the fixture catalog alone, who the current preview viewer is and whom they may address.
 * Fans address only the room owner privately; streamers address everyone (SHARED) or an authorised fan.
 */
export function PreviewRoleSummary({ role, room }: { role: PreviewRole; room: PreviewRoom }) {
  const viewer: PreviewActor = role === 'fan' ? previewActors.fanA : ownerOf(room);
  const owner = ownerOf(room);
  const authorizedFans = room.authorizedFanActorIds.map(actorById);

  return (
    <section
      aria-label="미리보기 역할과 수신 대상"
      data-preview-role={role}
      data-preview-room={room.roomId}
      className="flex flex-col gap-3 border-b border-line-subtle px-4 py-3 text-[14px] text-body"
    >
      <div className="flex flex-wrap items-center gap-2">
        <Badge variant="outline">{role === 'fan' ? '팬 화면' : '스트리머 화면'}</Badge>
        <span>
          보는 사람: <strong className="text-ink">{viewer.displayName}</strong>
        </span>
        <span className="text-muted">·</span>
        <span>
          방: <strong className="text-ink">{room.title}</strong>
        </span>
      </div>
      <div className="flex flex-wrap items-center gap-2" data-preview-recipients>
        <span className="font-semibold text-ink">보낼 수 있는 대상</span>
        {role === 'fan' ? (
          <Badge variant="brand">개인 메시지 → {owner.displayName}</Badge>
        ) : (
          <>
            <Badge variant="secondary">전체 (방 참여자)</Badge>
            {authorizedFans.map((fan) => (
              <Badge key={fan.actorId} variant="brand">
                개인답장 → {fan.displayName}
              </Badge>
            ))}
          </>
        )}
      </div>
    </section>
  );
}

function ownerOf(room: PreviewRoom): PreviewActor {
  return actorById(room.ownerActorId);
}

function actorById(actorId: string): PreviewActor {
  const actor = Object.values(previewActors).find((candidate) => candidate.actorId === actorId);
  if (!actor) throw new Error('Unknown preview actor');
  return actor;
}

export { previewRooms };
