package chat.rogi.rogichat.core.push

import java.util.UUID

/** Session epoch is the coordinator-owned invalidation identity; installation epoch is protected on disk. */
data class PushScope(val environment: String, val accountId: String, val accountGeneration: String,
                     val sessionEpoch: UUID, val installationEpoch: UUID)
enum class PushPermission { UNKNOWN, NOT_DETERMINED, DENIED, AUTHORIZED }
enum class PushRegistrationState { INACTIVE, UNAVAILABLE, FETCHING, REGISTERING, REGISTERED, RETRY_REQUIRED }
class DevicePushToken(val value: String) {
    init { require(value.isNotBlank() && value.length <= 4096 && value.none { it.isWhitespace() || it.isISOControl() }) }
    override fun toString() = "DevicePushToken([redacted])"
}
class PushTicket internal constructor(internal val id: UUID, val scope: PushScope)

/** Caller-confined lifecycle. A provider callback is NOT proof of server registration.
 * Adapted Meloming PushNotificationManager refresh/register/reset responsibilities;
 * replaced its cached bearer check with exact operation + persistent scope binding.
 */
class PushLifecycle {
    private var scope: PushScope? = null
    private var permission = PushPermission.UNKNOWN
    private var ticket: PushTicket? = null
    private var token: DevicePushToken? = null
    private var available = false
    var state = PushRegistrationState.INACTIVE
        private set

    fun bind(scope: PushScope?, permission: PushPermission, serverRegistrationAvailable: Boolean) {
        // Call with null on logout, SOOP revocation or expiry BEFORE any async cleanup.
        if (this.scope != scope || this.permission != permission || available != serverRegistrationAvailable) {
            ticket = null; token = null
            this.scope = scope; this.permission = permission; available = serverRegistrationAvailable
            state = when {
                scope == null || permission != PushPermission.AUTHORIZED -> PushRegistrationState.INACTIVE
                !available -> PushRegistrationState.UNAVAILABLE
                else -> PushRegistrationState.RETRY_REQUIRED
            }
        }
    }
    /** Re-fetch from provider on foreground/retry/rotation; never replay a cached account token. */
    fun beginTokenFetch(): PushTicket? {
        val current = scope ?: return null
        if (permission != PushPermission.AUTHORIZED || !available) return null
        token = null
        return PushTicket(UUID.randomUUID(), current).also { ticket = it; state = PushRegistrationState.FETCHING }
    }
    fun tokenReceived(request: PushTicket, value: DevicePushToken): Boolean {
        if (!current(request) || state != PushRegistrationState.FETCHING) return false
        token = value; state = PushRegistrationState.REGISTERING
        return true
    }
    fun registrationToken(request: PushTicket): DevicePushToken? =
        if (current(request) && state == PushRegistrationState.REGISTERING) token else null
    /** Only the real transport's validated success may call this. */
    fun registered(request: PushTicket): Boolean {
        if (!current(request) || state != PushRegistrationState.REGISTERING) return false
        token = null; ticket = null; state = PushRegistrationState.REGISTERED
        return true
    }
    fun failed(request: PushTicket): Boolean {
        if (!current(request)) return false
        ticket = null; token = null; state = PushRegistrationState.RETRY_REQUIRED
        return true
    }
    private fun current(request: PushTicket) = ticket === request && scope == request.scope &&
        permission == PushPermission.AUTHORIZED && available
}
