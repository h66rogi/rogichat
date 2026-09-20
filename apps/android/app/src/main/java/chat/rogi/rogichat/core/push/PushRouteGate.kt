package chat.rogi.rogichat.core.push

import chat.rogi.rogichat.core.navigation.ContentRouteParser
import chat.rogi.rogichat.core.navigation.PendingRouteQueue
import chat.rogi.rogichat.core.navigation.RoomRouteHint
import chat.rogi.rogichat.core.navigation.RouteTicket

/** Warm taps and cold launch share one queue, adapted from Meloming single dispatch.
 * Never trust provider payload membership; OS owner must re-fetch /me and room detail.
 */
class PushRouteGate(private val parser: ContentRouteParser) {
    private val queue = PendingRouteQueue()
    private var scope: PushScope? = null
    fun bind(value: PushScope?) {
        if (scope != value) { queue.resetScope(); scope = value }
    }
    fun offer(url: String, eventId: String, expected: PushScope, now: Long): Boolean {
        if (expected != scope) return false
        val hint = parser.parse(url) ?: return false
        return queue.offer(hint, eventId, now, queue.scopeToken)
    }
    fun begin(now: Long): RouteTicket? = if (scope != null) queue.begin(now) else null
    /** Call synchronously after real authorization returns, before navigating on same dispatcher. */
    fun authorized(ticket: RouteTicket, expected: PushScope, roomId: String, now: Long): RoomRouteHint? {
        if (expected != scope || ticket.hint.roomId != roomId) return null
        return queue.consume(ticket, now)
    }
    fun denied(ticket: RouteTicket) { queue.cancel(ticket) }
}
