package chat.rogi.rogichat.core.navigation

import java.net.URI

// Not registered with Android intents. A verified environment policy must be injected by a future adapter.
data class RoomRouteHint(val roomId: String)
class ContentRouteParser(private val allowedHost: String, private val roomPathPrefix: String) {
    fun parse(value: String): RoomRouteHint? {
        if (value.length > 2048) return null
        val uri = try { URI(value) } catch (_: Exception) { return null }
        if (uri.scheme != "https" || uri.host != allowedHost || uri.port != -1 || uri.rawUserInfo != null ||
            uri.rawQuery != null || uri.rawFragment != null) return null
        val path = uri.rawPath ?: return null
        if (!path.startsWith(roomPathPrefix)) return null
        val id = path.removePrefix(roomPathPrefix)
        return if (id.matches(Regex("[A-Za-z0-9_-]{1,128}"))) RoomRouteHint(id) else null
    }
}

class RouteTicket internal constructor(val revision: Long, val scope: Long, val hint: RoomRouteHint,
                                            internal val eventId: String, internal val expiresAt: Long)

// Caller-confined reducer. Time must be monotonic; it never navigates or asserts server authorization.
class PendingRouteQueue {
    private var scope = 0L
    private var revision = 0L
    private var pending: RouteTicket? = null
    private val consumed = linkedMapOf<String, Long>()
    val scopeToken: Long get() = scope
    fun resetScope() { scope++; revision++; pending = null; consumed.clear() }
    fun cancel(ticket: RouteTicket): Boolean {
        if (pending != ticket || ticket.scope != scope) return false
        pending = null; revision++
        return true
    }
    fun offer(hint: RoomRouteHint, eventId: String, now: Long, expectedScope: Long): Boolean {
        if (expectedScope != scope) return false
        require(now >= 0 && now <= Long.MAX_VALUE - TTL)
        if (eventId.isBlank() || eventId.length > 256) return false
        consumed.entries.removeAll { it.value <= now }
        if (consumed.containsKey(eventId) || pending?.let { it.eventId == eventId && it.expiresAt > now } == true) return false
        revision++
        pending = RouteTicket(revision, scope, hint, eventId, now + TTL)
        return true
    }
    fun begin(now: Long): RouteTicket? {
        if (pending?.let { now >= it.expiresAt } == true) pending = null
        return pending
    }
    // Call after await: only the still-current ticket may be applied to the UI in the same turn.
    fun consume(ticket: RouteTicket, now: Long): RoomRouteHint? {
        val current = begin(now) ?: return null
        if (current != ticket || ticket.scope != scope) return null
        pending = null
        consumed[ticket.eventId] = ticket.expiresAt
        while (consumed.size > 64) consumed.remove(consumed.keys.first())
        return ticket.hint
    }
    companion object { const val TTL = 300_000L }
}
