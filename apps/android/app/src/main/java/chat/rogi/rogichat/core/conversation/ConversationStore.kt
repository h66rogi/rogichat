package chat.rogi.rogichat.core.conversation

import chat.rogi.rogichat.core.network.*
import chat.rogi.rogichat.core.rooms.*

/** No phase authorizes replay. Only the session-owned live admission may POST a new command once. */
enum class OutboxPhase { PREPARED, SENDING, UNKNOWN, COMMITTED, DELETED, REJECTED, PARKED }
data class OutboxRecord(val command: TextCommand, val authorization: RoomScopeToken, val phase: OutboxPhase,
                        val createdAtMs: Long, val messageId: RoomId? = null, val version: MessageVersion? = null,
                        val errorCode: String? = null) {
    override fun toString() = "OutboxRecord([redacted])"
}
data class ConversationData(val scope: ConversationScope, val messages: List<ConversationMessage>,
                            val profiles: List<ConversationProfile>, val profileComplete: Boolean,
                            val eventsCursor: SyncCursor?, val historyCursor: SyncCursor?, val outbox: List<OutboxRecord>)

/** Implemented by the same account Room database. Caller holds the credential lifecycle mutex through COMMIT. */
interface ConversationStore {
    suspend fun authorize(scope: RoomsAccountScope, credentialBinding: String, serverGeneration: String, validate: () -> Unit)
    /** Withdraw UI/cache authority while keeping immutable pending commands parked for read-only recovery. */
    suspend fun withdrawAuthority()
    suspend fun beginConversation(selection: ConversationSelection, validate: () -> Unit): ConversationScope
    suspend fun snapshot(scope: ConversationScope, page: SnapshotPage, validate: () -> Unit): ConversationData
    suspend fun events(scope: ConversationScope, requested: SyncCursor, page: EventPage.Success, validate: () -> Unit): ConversationData
    suspend fun history(scope: ConversationScope, requested: SyncCursor, page: HistoryPage.Success, validate: () -> Unit): ConversationData
    suspend fun profiles(scope: ConversationScope, requested: SyncCursor?, page: ProfilePage.Success, validate: () -> Unit): ConversationData
    suspend fun current(scope: ConversationScope, validate: () -> Unit): ConversationData
    suspend fun enqueue(scope: ConversationScope, command: TextCommand, createdAtMs: Long, validate: () -> Unit): OutboxRecord
    suspend fun markSending(scope: ConversationScope, commandId: RoomId, validate: () -> Unit)
    suspend fun markUnknown(scope: ConversationScope, commandId: RoomId, errorCode: String?, validate: () -> Unit)
    suspend fun receipt(scope: ConversationScope, commandId: RoomId, receipt: CommandReceipt, validate: () -> Unit): ConversationData
    suspend fun unavailableProjection(scope: ConversationScope, commandId: RoomId, messageId: RoomId, validate: () -> Unit): ConversationData
    suspend fun projection(scope: ConversationScope, message: ConversationMessage, validate: () -> Unit): ConversationData
}
