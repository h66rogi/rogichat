package chat.rogi.rogichat.core.conversation

import chat.rogi.rogichat.core.network.*

/** Opaque captured credential admission. UI never receives a bearer or constructs a lease. */
class ConversationPermit internal constructor(val selection: ConversationSelection, val deviceId: RoomId, internal val handle: Any, val sessionIdentity: String = java.util.UUID.randomUUID().toString(), private val validate: () -> Unit = {}) {
    fun check() = validate()
}
interface ConversationGateway {
    suspend fun admitConversation(selection: ConversationSelection): ConversationPermit
    suspend fun <T> conversationRequest(permit: ConversationPermit, request: suspend (NativeApi, String) -> T): T
    suspend fun <T> conversationCommit(permit: ConversationPermit, action: suspend (() -> Unit) -> T): T
}
