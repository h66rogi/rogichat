// A legacy fan-authored original may still live in the room's shared stream.
// Stream kind alone is not its audience: only the fan and current owner may
// read it. Owner messages and explicit anonymous publication copies stay shared.
export const publishedCopySql = (message: string, includeRevoked = false) =>
  `EXISTS (SELECT 1 FROM message_publications publication WHERE publication.room_id=${message}.room_id AND publication.published_message_id=${message}.id${includeRevoked ? '' : " AND publication.state='PUBLISHED'"})`;

export const fanSharedVisibleSql = (message: string, room: string, viewer: string, includeRevoked = false) =>
  `(${room}.mode<>'FAN' OR ${message}.sender_member_id=${viewer}.id OR ${room}.owner_member_id=${viewer}.id OR (` +
  `${message}.deletion_root_id IS NULL AND ${message}.sender_member_id=${room}.owner_member_id) OR (` +
  `${message}.deletion_root_id IS NOT NULL AND ${publishedCopySql(message, includeRevoked)}))`;

export const fanSharedVisible = (facts: {
  roomMode: 'FAN' | 'GROUP'; senderMemberId: string; viewerMemberId: string;
  ownerMemberId: string | null; published: boolean; publicationActive: boolean;
}): boolean => facts.roomMode !== 'FAN' || facts.senderMemberId === facts.viewerMemberId ||
  facts.ownerMemberId === facts.viewerMemberId ||
  !facts.published && facts.senderMemberId === facts.ownerMemberId ||
  facts.published && facts.publicationActive;
