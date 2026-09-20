package chat.rogi.rogichat.core.rooms

import chat.rogi.rogichat.core.network.*

/** Captured by the screen before dispatch, not re-created from the current account after suspension. */
data class RoomsAccountScope(val accountId: String, val localEpoch: Long, val partition: AccountPartition)
data class RoomSyncIdentity(val deviceId: RoomId, val cacheId: RoomId)
data class DiscoveryContinuation(val cacheId: RoomId, val after: RoomId)
data class RoomDirectory(val memberships: List<Membership>, val discovered: List<DiscoveredRoom>,
                         val continuation: DiscoveryContinuation?, val cycle: RoomId)
class RoomsStorageException : Exception("rooms_storage_failed")
class RoomsResetRequired : Exception("rooms_reset_required")

/** All calls belong to the session coordinator's serialized lifecycle, including transaction commit.
 * validate runs inside the SQLite transaction after writes and before commit. It must not suspend.
 * This directory interface has no message payload. The separate ConversationStore extends the same
 * account database; credentials and raw account user IDs are never persisted in either interface.
 */
interface RoomsStore {
    suspend fun begin(scope: RoomsAccountScope, validate: () -> Unit): RoomSyncIdentity
    suspend fun manifest(scope: RoomsAccountScope, identity: RoomSyncIdentity, requested: SyncCursor?,
                         page: MembershipPage, validate: () -> Unit)
    suspend fun discovery(scope: RoomsAccountScope, identity: RoomSyncIdentity, after: RoomId?,
                          page: DiscoveryPage, validate: () -> Unit): RoomDirectory
    suspend fun clearForDeletion(partition: AccountPartition?) { clear() }
    suspend fun clear()
}
