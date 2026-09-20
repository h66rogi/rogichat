package chat.rogi.rogichat.core.realtime

import java.util.UUID

data class RealtimeScope(val environment: String, val accountId: String, val accountGeneration: String, val sessionEpoch: UUID) {
    init { require(environment in setOf("qa", "prod") && accountId.isNotBlank() && accountGeneration.isNotBlank()) }
}
/** Read-only Socket.IO default namespace; credentials must never enter URL/auth payload/logs. */
class RealtimeConnectionOptions(scope: RealtimeScope, private val bearer: String) {
    init { require(bearer.matches(Regex("[A-Za-z0-9_-]{43}"))) }
    val origin = if (scope.environment == "qa") "https://api.qa.rogi.chat" else "https://api.rogi.chat"
    val path = "/v1/realtime"
    val namespace = "/"
    val transports = listOf("websocket")
    val reconnects = false
    val headers: Map<String, List<String>> get() = mapOf("Authorization" to listOf("Bearer $bearer"), "X-Rogi-Client" to listOf("android"))
    val auth: Map<String, Any> get() = mapOf("schemaVersion" to 1, "transport" to "native")
    override fun toString() = "RealtimeConnectionOptions([redacted])"
}
object RealtimeHint {
    // Exact one-field server DTO; reject extras, duplicate keys and strings/bools.
    fun valid(json: String): Boolean = json.length <= 128 &&
        json.matches(Regex("[ \\t\\r\\n]*\\{[ \\t\\r\\n]*\"schemaVersion\"[ \\t\\r\\n]*:[ \\t\\r\\n]*1[ \\t\\r\\n]*}[ \\t\\r\\n]*"))
}
enum class RealtimeStatus { DISCONNECTED, CONNECTING, CONNECTED, REVALIDATION_REQUIRED }
class RealtimeTicket internal constructor(val scope: RealtimeScope)

/** OS owner supplies protected persistent epoch; never a view-local account counter. */
class RealtimeLifecycle {
    private var scope: RealtimeScope? = null
    private var foreground = false
    private var ticket: RealtimeTicket? = null
    var status = RealtimeStatus.DISCONNECTED
        private set
    fun bind(scope: RealtimeScope?, foreground: Boolean): Boolean {
        if (this.scope == scope && this.foreground == foreground) return false
        this.scope = scope; this.foreground = foreground; ticket = null; status = RealtimeStatus.DISCONNECTED
        return true
    }
    fun begin(expected: RealtimeScope): RealtimeTicket? {
        if (scope != expected || !foreground) return null
        return RealtimeTicket(expected).also { ticket = it; status = RealtimeStatus.CONNECTING }
    }
    fun connected(value: RealtimeTicket): Boolean {
        if (!current(value) || status != RealtimeStatus.CONNECTING) return false
        status = RealtimeStatus.CONNECTED
        return true
    }
    fun wake(value: RealtimeTicket, payload: String) = current(value) && status == RealtimeStatus.CONNECTED && RealtimeHint.valid(payload)
    fun disconnected(value: RealtimeTicket): Boolean {
        if (!current(value) || status == RealtimeStatus.REVALIDATION_REQUIRED) return false
        status = RealtimeStatus.REVALIDATION_REQUIRED
        return true
    }
    fun canReconnect(value: RealtimeTicket) = current(value) && status == RealtimeStatus.REVALIDATION_REQUIRED
    fun close(value: RealtimeTicket) {
        if (current(value)) { ticket = null; status = RealtimeStatus.DISCONNECTED }
    }
    private fun current(value: RealtimeTicket) = ticket === value && scope == value.scope && foreground
}
