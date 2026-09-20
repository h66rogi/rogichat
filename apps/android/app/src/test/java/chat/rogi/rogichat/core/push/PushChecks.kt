package chat.rogi.rogichat.core.push

import chat.rogi.rogichat.core.navigation.ContentRouteParser
import java.util.UUID

/** Standalone low-memory checks; test fixtures never enter runtime source sets. */
object PushChecks {
    @JvmStatic fun main(args: Array<String>) {
        val install = UUID.randomUUID()
        fun scope(account: String) = PushScope("qa", account, "generation", UUID.randomUUID(), install)
        val a = scope("a"); val b = scope("b"); val aAgain = scope("a")
        val token = DevicePushToken("test-only-provider-value")
        val model = PushLifecycle()
        model.bind(a, PushPermission.AUTHORIZED, false)
        check(model.state == PushRegistrationState.UNAVAILABLE && model.beginTokenFetch() == null)
        for (permission in listOf(PushPermission.DENIED, PushPermission.UNKNOWN, PushPermission.NOT_DETERMINED)) {
            model.bind(a, permission, true); check(model.beginTokenFetch() == null)
        }
        model.bind(a, PushPermission.AUTHORIZED, true)
        val old = model.beginTokenFetch()!!; val rotated = model.beginTokenFetch()!!
        check(!model.tokenReceived(old, token)); check(model.tokenReceived(rotated, token))
        check(!model.registered(old)); check(model.failed(rotated))
        check(model.state == PushRegistrationState.RETRY_REQUIRED && !model.registered(rotated))
        val retry = model.beginTokenFetch()!!
        check(model.tokenReceived(retry, token) && model.registered(retry))
        check(model.state == PushRegistrationState.REGISTERED && !model.registered(retry))
        val late = model.beginTokenFetch()!!
        model.bind(b, PushPermission.AUTHORIZED, true); model.bind(aAgain, PushPermission.AUTHORIZED, true)
        check(!model.tokenReceived(late, token))
        val logout = model.beginTokenFetch()!!; check(model.tokenReceived(logout, token))
        model.bind(null, PushPermission.AUTHORIZED, true)
        check(!model.registered(logout) && model.registrationToken(logout) == null)
        check(token.toString() == "DevicePushToken([redacted])")
        check(NativePushWake.accepts(mapOf("type" to "sync_required", "version" to "1")))
        check(!NativePushWake.accepts(mapOf("type" to "sync_required", "version" to "01")))
        check(!NativePushWake.accepts(mapOf("type" to "sync_required", "version" to "1", "url" to "https://qa.rogi.chat/rooms/one")))

        val gate = PushRouteGate(ContentRouteParser("qa.rogi.chat", "/rooms/"))
        gate.bind(a)
        check(!gate.offer("https://rogi.chat/rooms/one", "event", a, 0))
        check(gate.offer("https://qa.rogi.chat/rooms/one", "event", a, 0))
        val cold = gate.begin(1)!!
        check(gate.authorized(cold, a, "different", 2) == null)
        gate.bind(b); gate.bind(aAgain)
        check(gate.authorized(cold, a, "one", 3) == null)
        check(gate.offer("https://qa.rogi.chat/rooms/one", "event", aAgain, 4))
        val warm = gate.begin(5)!!
        check(gate.authorized(warm, aAgain, "one", 6)?.roomId == "one")
        check(gate.authorized(warm, aAgain, "one", 7) == null)
        check(!gate.offer("https://qa.rogi.chat/rooms/one", "event", aAgain, 8))
        check(gate.offer("https://qa.rogi.chat/rooms/one", "expired", aAgain, 9))
        val expired = gate.begin(10)!!
        check(gate.authorized(expired, aAgain, "one", 300009) == null)
        println("Push lifecycle and launch reauthorization checks passed")
    }
}
