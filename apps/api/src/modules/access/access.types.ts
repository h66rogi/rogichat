// Authoritative membership facts returned by AccessService on the caller's transaction.
export interface ActiveMember {
  id: string; room_id: string; user_id: string; role: 'FAN' | 'MEMBER' | 'STREAMER';
  mode: 'FAN' | 'GROUP'; active_period_id: string; visible_from_order: string;
  temporaryGrantId?: string; temporaryExpiresAt?: Date;
}
