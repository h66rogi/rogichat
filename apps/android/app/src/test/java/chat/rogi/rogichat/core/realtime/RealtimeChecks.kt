package chat.rogi.rogichat.core.realtime

import java.util.UUID
import kotlinx.coroutines.channels.Channel
import kotlinx.coroutines.runBlocking
import kotlinx.coroutines.launch
import kotlinx.coroutines.cancelAndJoin
import kotlinx.coroutines.flow.collect

private class TestSocket : RealtimeSocketDriver {
    var connected: (() -> Unit)? = null
    var disconnected: (() -> Unit)? = null
    var error: (() -> Unit)? = null
    var wake: ((String) -> Unit)? = null
    var disconnects = 0
    override fun onConnected(callback: () -> Unit) { connected = callback }
    override fun onDisconnected(callback: () -> Unit) { disconnected = callback }
    override fun onError(callback: () -> Unit) { error = callback }
    override fun onSyncRequired(callback: (String) -> Unit) { wake = callback }
    override fun connect() {}
    override fun removeAllHandlers() { connected = null; disconnected = null; error = null; wake = null }
    override fun disconnect() { disconnects++ }
}
object RealtimeChecks {
    @JvmStatic fun main(args: Array<String>) = runBlocking {
        fun scope(id: String) = RealtimeScope("qa", id, "generation", UUID.randomUUID())
        val a = scope("a"); val b = scope("b"); val aAgain = scope("a")
        val sockets = Channel<TestSocket>(Channel.UNLIMITED)
        val events = Channel<RealtimeEvent>(Channel.UNLIMITED)
        val manager = NativeRealtimeManager { options ->
            check(options.path == "/v1/realtime" && options.namespace == "/" && !options.reconnects)
            check(options.transports == listOf("websocket") && options.auth == mapOf("schemaVersion" to 1, "transport" to "native"))
            check(options.headers["X-Rogi-Client"] == listOf("android") && !options.headers.containsKey("Cookie"))
            TestSocket().also { sockets.trySend(it) }
        }
        val bearer = "A".repeat(43)
        manager.bind(a, true)
        val firstJob = launch { manager.connect(a, bearer).collect { events.send(it) } }
        val first = sockets.receive()
        val lateConnect = first.connected!!; val lateWake = first.wake!!; val lateError = first.error!!
        first.wake!!("{\"schemaVersion\":1}"); check(events.tryReceive().isFailure)
        first.connected!!(); check(events.receive() is RealtimeEvent.SyncRequired)
        first.connected!!(); check(events.tryReceive().isFailure)
        first.wake!!("{\"schemaVersion\":1}"); check(events.receive() is RealtimeEvent.SyncRequired)
        for (invalid in listOf("{}", "{\"schemaVersion\":true}", "{\"schemaVersion\":\"1\"}", "{\"schemaVersion\":1,\"roomId\":\"x\"}", "{\"schemaVersion\":1,\"schemaVersion\":1}")) {
            check(!RealtimeHint.valid(invalid))
        }
        first.disconnected!!()
        val retry = (events.receive() as RealtimeEvent.RevalidationRequired).ticket
        firstJob.join(); check(first.disconnects > 0)
        lateError(); check(events.tryReceive().isFailure)
        val secondJob = launch { manager.reconnect(retry, bearer).collect { events.send(it) } }
        val second = sockets.receive(); val lateSecond = second.connected!!
        manager.reconnect(retry, bearer).collect { error("stale retry") }
        lateConnect(); lateWake("{\"schemaVersion\":1}"); check(events.tryReceive().isFailure)
        manager.bind(b, true); manager.bind(aAgain, true)
        secondJob.join(); lateSecond(); check(events.tryReceive().isFailure && second.disconnects > 0)
        manager.connect(a, bearer).collect { error("stale scope") }
        val thirdJob = launch { manager.connect(aAgain, bearer).collect { events.send(it) } }
        val third = sockets.receive(); val lateThird = third.connected!!
        manager.bind(aAgain, false); thirdJob.join(); lateThird()
        check(events.tryReceive().isFailure && third.disconnects > 0)
        manager.connect(aAgain, bearer).collect { error("background") }
        manager.bind(null, false)
        manager.bind(aAgain, true)
        val cancelledJob = launch { manager.connect(aAgain, bearer).collect { events.send(it) } }
        val cancelled = sockets.receive()
        cancelledJob.cancelAndJoin()
        check(cancelled.disconnects > 0 && manager.status == RealtimeStatus.DISCONNECTED)
        val unavailable = NativeRealtimeManager { throw IllegalStateException("test driver unavailable") }
        unavailable.bind(a, true)
        val unavailableEvents = mutableListOf<RealtimeEvent>()
        unavailable.connect(a, bearer).collect { unavailableEvents.add(it) }
        check(unavailableEvents.single() is RealtimeEvent.RevalidationRequired)
        println("Realtime lifecycle, reconnect, payload and stale callback checks passed")
    }
}
