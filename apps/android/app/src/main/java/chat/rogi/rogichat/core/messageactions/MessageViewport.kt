package chat.rogi.rogichat.core.messageactions

sealed interface ViewportMove {
    data object None : ViewportMove
    data object Latest : ViewportMove
    data class Restore(val anchor: ScrollAnchor) : ViewportMove
}
/** Feed only IDs newly committed by sync; history pages are not incoming messages. */
class MessageViewport {
    private var initialized = false
    private var followsLatest = false
    private var visible: ScrollAnchor? = null
    private val incoming = mutableSetOf<String>()
    val incomingCount get() = incoming.size
    fun reset() { initialized = false; followsLatest = false; visible = null; incoming.clear() }
    fun initialize(restored: ScrollAnchor?): ViewportMove {
        if (initialized) return ViewportMove.None
        initialized = true; visible = restored; followsLatest = restored == null
        return restored?.let(ViewportMove::Restore) ?: ViewportMove.Latest
    }
    fun observed(anchor: ScrollAnchor?, atLatest: Boolean) {
        visible = anchor; followsLatest = atLatest; if (atLatest) incoming.clear()
    }
    fun olderPageCommitted(): ViewportMove = visible?.let(ViewportMove::Restore) ?: ViewportMove.None
    fun incomingCommitted(ids: Set<String>): ViewportMove {
        ids.forEach(::actionId)
        if (!initialized || ids.isEmpty()) return ViewportMove.None
        if (followsLatest) return ViewportMove.Latest
        incoming.addAll(ids); return ViewportMove.None
    }
    fun showLatest(): ViewportMove { followsLatest = true; incoming.clear(); return ViewportMove.Latest }
    fun deleted(messageId: String) { incoming.remove(messageId); if (visible?.messageId == messageId) visible = null }
}
