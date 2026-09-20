import type { RowDataPacket } from 'mysql2';

export interface MessageRow extends RowDataPacket {
  id: string; room_id: string; stream_id: string; sender_member_id: string;
  content_owner_user_id: string; deletion_root_id: string | null; quote_id: string | null;
  text_content: string | null; content_kind: string; version: string; created_order: string;
  created_at: Date; deleted_at: Date | null; moderated: number; stream_kind: 'ROOM_SHARED' | 'RESTRICTED';
  nickname: string; content_owner_status: string; root_blocked: number; avatar_id: string | null;
}

export interface MessageIdRow extends RowDataPacket { id: string }
export interface MessageGrantRow extends RowDataPacket {
  member_id: string; room_id: string; stream_id: string; can_read: number;
}
export interface MessageAttachmentRow extends RowDataPacket {
  id: string; width: number; height: number; variant: string;
}
export interface MessageTargetRow extends RowDataPacket { id: string; role: string }
export interface MessagePairRow extends RowDataPacket { stream_id: string }
export interface MessageSendGrantRow extends RowDataPacket {
  member_id: string; can_read: number; can_send: number;
}
export interface MessageRoomRow extends RowDataPacket { id: string; status: string }
export interface MessageReceiptRow extends RowDataPacket {
  message_id: string; payload_digest: Buffer | null; digest_version: number; deleted: number;
}
export interface OwnedMessageRow extends RowDataPacket {
  id: string; stream_id: string; version: string; deleted_at: Date | null;
}
export type MessageEventKind = 'MESSAGE_CREATED' | 'MESSAGE_DELETED' | 'MESSAGE_UPDATED';
