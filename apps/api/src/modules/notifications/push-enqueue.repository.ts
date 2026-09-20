import { Injectable } from '@nestjs/common';
import type { Transaction } from '../../infrastructure/database/transactions.js';

@Injectable()
export class PushEnqueueRepository {
  async eligible(tx: Transaction, messageId: string, subscriptionId: string) {
    // Current-row lock exception: serialize intent creation with recipient/source
    // account deletion, session revocation, subscription rotation and preference
    // changes. A snapshot-only discovery is insufficient for the deletion fence.
    const [row] = await tx.rows<{ room_id: string; generation: string; account_generation: string; preference_generation: string }>(`
      SELECT m.room_id,s.generation,s.account_generation,p.generation AS preference_generation
      FROM push_subscriptions s JOIN users u ON u.id=s.user_id
      JOIN auth_sessions a ON a.id=s.session_id AND a.user_id=s.user_id
      JOIN notification_preferences p ON p.user_id=s.user_id
      JOIN platform_soop soop ON soop.user_id=u.id
      JOIN messages m ON m.id=? JOIN users owner ON owner.id=m.content_owner_user_id
      JOIN rooms r ON r.id=m.room_id
      LEFT JOIN messages root ON root.id=m.deletion_root_id AND root.room_id=m.room_id
      LEFT JOIN users root_owner ON root_owner.id=root.content_owner_user_id
      WHERE s.id=? AND s.revoked_at IS NULL AND u.status='ACTIVE'
        AND soop.status='VERIFIED' AND s.account_generation=u.membership_generation
        AND a.revoked_at IS NULL AND a.expires_at>UTC_TIMESTAMP(3) AND a.audience=s.audience
        AND ((s.provider='WEB' AND a.transport='WEB' AND a.client_id IS NULL)
          OR (s.provider='APNS' AND s.native_client_id='ios' AND a.transport='NATIVE' AND a.client_id='ios')
          OR (s.provider='FCM' AND s.native_client_id='android' AND a.transport='NATIVE' AND a.client_id='android'))
        AND p.push_enabled=1 AND s.updated_at<=m.created_at AND p.updated_at<=m.created_at
        AND m.deleted_at IS NULL AND m.moderated=0 AND owner.status NOT IN ('DELETING','DELETED') AND r.status='ACTIVE'
        AND (m.deletion_root_id IS NULL OR (root.id IS NOT NULL AND root.deleted_at IS NULL AND root.moderated=0 AND root_owner.status NOT IN ('DELETING','DELETED')))
      FOR UPDATE`, [messageId, subscriptionId]);
    return row;
  }
}
