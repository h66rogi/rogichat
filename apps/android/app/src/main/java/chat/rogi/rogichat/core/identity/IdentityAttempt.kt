package chat.rogi.rogichat.core.identity

import java.util.UUID

enum class IdentityIntent { LOGIN, LINK }
data class IdentityScope(val environment: String, val sessionEpoch: UUID, val accountId: String?)
class IdentityTicket internal constructor(val scope: IdentityScope, val intent: IdentityIntent)

/** Scope comes from protected persistent epoch; provider identity never grants SOOP chat access. */
class IdentityAttempt {
    private var scope: IdentityScope? = null
    private var pending: IdentityTicket? = null
    fun bind(value: IdentityScope) { if (scope != value) { pending = null; scope = value } }
    fun begin(intent: IdentityIntent): IdentityTicket? {
        val scope = scope ?: return null
        if (if (intent == IdentityIntent.LOGIN) scope.accountId != null else scope.accountId == null) return null
        return IdentityTicket(scope, intent).also { pending = it }
    }
    fun current(ticket: IdentityTicket) = pending === ticket && scope == ticket.scope
    fun consume(ticket: IdentityTicket): Boolean {
        if (!current(ticket)) return false
        pending = null
        return true
    }
    fun cancel() { pending = null }
}
