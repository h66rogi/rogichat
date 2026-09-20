// Fixed source-only aliases. This predicate belongs inside ACL-before-LIMIT
// queries: pagination must never be influenced by inaccessible fan messages.
export function delegatedMemberSql(member: 'm' | 'rm' | 'viewer' | 'target') {
  return `EXISTS (SELECT 1 FROM room_test_grants dg JOIN admin_capabilities da ON da.user_id=${member}.user_id AND da.manage_test_access=1 JOIN users du ON du.id=da.user_id AND du.status='ACTIVE' WHERE dg.room_id=${member}.room_id AND dg.member_id=${member}.id AND dg.period_id=${member}.active_period_id AND dg.revoked_at IS NULL AND dg.created_at<=UTC_TIMESTAMP(3) AND dg.expires_at>UTC_TIMESTAMP(3))`;
}
