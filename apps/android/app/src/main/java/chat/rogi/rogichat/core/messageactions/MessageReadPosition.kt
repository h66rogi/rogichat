package chat.rogi.rogichat.core.messageactions

import chat.rogi.rogichat.core.auth.StrictAuthJson
import kotlinx.serialization.json.*
import chat.rogi.rogichat.core.network.M11Dtos
import chat.rogi.rogichat.core.network.ReadContext
import chat.rogi.rogichat.core.network.ReadStateId

/** Own display progress is not unread count, delivery ACK, a stream order or a sync cursor. */
data class ReadSnapshot(val context: String, val messageIds: List<String>, val firstUnreadMessageId: String? = null)
data class ScrollAnchor(val messageId: String, val offset: Int) {
    init { actionId(messageId); require(offset >= 0) }
}
interface ScrollAnchorStore {
    fun load(scope: ActionScope): ScrollAnchor?
    fun save(scope: ActionScope, anchor: ScrollAnchor?)
}
class ReadViewToken internal constructor(val scope: ActionScope, internal val generation: Long) {
    override fun equals(other: Any?) = other is ReadViewToken && scope == other.scope && generation == other.generation
    override fun hashCode() = 31 * scope.hashCode() + generation.hashCode()
}
class ReadDisplayPermit internal constructor(val token: ReadViewToken, val messageId: String,
    val context: String, private val owner: MessageReadPosition) {
    private var used = false
    fun claim() = synchronized(owner) {
        check(!used && owner.admits(token) && owner.pending === this) { "stale_read_context" }; used = true
    }
    fun request() = ActionRequest("PUT", "rooms/${token.scope.roomId}/read-state",
        M11Dtos.displayed(ReadStateId(messageId), ReadContext(context)), 200)
}
class MessageReadPosition(private val anchors: ScrollAnchorStore) {
    private var generation = 0L
    private var scope: ActionScope? = null
    private var context: String? = null
    var pending: ReadDisplayPermit? = null; private set
    var savedMessageIds: List<String> = emptyList(); private set
    var needsRefresh = true; private set
    @Synchronized fun select(value: ActionScope?) {
        generation++; scope = value; context = null; pending = null; savedMessageIds = emptyList(); needsRefresh = true
    }
    @Synchronized fun capture() = scope?.let { ReadViewToken(it, generation) }
    internal fun admits(token: ReadViewToken) = scope == token.scope && generation == token.generation
    @Synchronized fun accept(token: ReadViewToken, snapshot: ReadSnapshot): Boolean {
        if (!admits(token) || pending != null || context != null || !needsRefresh) return false
        ReadContext(snapshot.context); require(snapshot.messageIds.size <= 100); snapshot.messageIds.forEach(::actionId)
        context = snapshot.context; savedMessageIds = snapshot.messageIds; needsRefresh = false; return true
    }
    /** Call ONLY for a newly visible authorized row after context GET; never replay restored positions. */
    @Synchronized fun displayed(token: ReadViewToken, messageId: String): ReadDisplayPermit? {
        actionId(messageId)
        if (!admits(token) || pending != null || needsRefresh || messageId in savedMessageIds) return null
        return ReadDisplayPermit(token, messageId, context ?: return null, this).also { pending = it }
    }
    /** Unknown/409 invalidates the context and drops queued display events; no automatic PUT retry. */
    @Synchronized fun finish(permit: ReadDisplayPermit, acknowledged: Boolean, savedMessageId: String?): Boolean {
        if (!admits(permit.token) || pending !== permit) return false
        savedMessageId?.let(::actionId); pending = null
        if (!acknowledged) { generation++; context = null; needsRefresh = true; savedMessageIds = emptyList() }
        else if (savedMessageId != null) savedMessageIds = (savedMessageIds + savedMessageId).distinct().takeLast(100)
        return true
    }
    @Synchronized fun saveAnchor(token: ReadViewToken, anchor: ScrollAnchor, currentlyReadable: Set<String>) {
        if (admits(token) && anchor.messageId in currentlyReadable) anchors.save(token.scope, anchor)
    }
    @Synchronized fun restoreAnchor(token: ReadViewToken, currentlyReadable: Set<String>): ScrollAnchor? {
        if (!admits(token)) return null
        val anchor = anchors.load(token.scope) ?: return null
        if (anchor.messageId !in currentlyReadable) { anchors.save(token.scope, null); return null }
        return anchor
    }
    @Synchronized fun deleted(messageId: String) {
        val current = scope ?: return
        if (anchors.load(current)?.messageId == messageId) anchors.save(current, null)
        savedMessageIds = savedMessageIds.filterNot { it == messageId }
        if (pending?.messageId == messageId) { generation++; pending = null; context = null; needsRefresh = true }
    }
    @Synchronized fun reset() { scope?.let { anchors.save(it, null) }; select(null) }
}
object MessageReadWire {
    fun get(scope: ActionScope) = ActionRequest("GET", "rooms/${scope.roomId}/read-state", null, 200)
    fun snapshot(body: String): ReadSnapshot {
        val root = StrictAuthJson.objectValue(body)
        require(root.keys == setOf("readContext", "items") ||
            root.keys == setOf("readContext", "items", "firstUnreadMessageId"))
        require(root.getValue("items").jsonArray.all { it.jsonObject.keys == setOf("messageId") })
        val value = M11Dtos.readStates(body)
        // Public GET projection only contains authorized IDs, unlike nullable PUT receipt.
        require(value.items.all { it.messageId != null })
        return ReadSnapshot(value.readContext.value, value.items.map { it.messageId!!.value }, value.firstUnreadMessageId?.value)
    }
    fun saved(body: String): String? {
        require(StrictAuthJson.objectValue(body).keys == setOf("messageId"))
        return M11Dtos.readState(body).messageId?.value
    }
}
