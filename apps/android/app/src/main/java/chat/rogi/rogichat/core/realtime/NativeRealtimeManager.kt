package chat.rogi.rogichat.core.realtime

import kotlinx.coroutines.channels.awaitClose
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.callbackFlow

/** Required production Socket.IO bridge; deliberately has no application emit API. */
interface RealtimeSocketDriver {
    fun onConnected(callback: () -> Unit)
    fun onDisconnected(callback: () -> Unit)
    fun onError(callback: () -> Unit)
    fun onSyncRequired(callback: (String) -> Unit)
    fun connect()
    fun removeAllHandlers()
    fun disconnect()
}
fun interface RealtimeSocketFactory { fun create(options: RealtimeConnectionOptions): RealtimeSocketDriver }
sealed interface RealtimeEvent {
    data class SyncRequired(val scope: RealtimeScope) : RealtimeEvent
    data class RevalidationRequired(val ticket: RealtimeTicket) : RealtimeEvent
}

/** Modified reuse of Meloming SongLiveSocketManager's callbackFlow/on/connect/
 * awaitClose teardown. Removes all join/application emits and logs; binds every
 * callback to an immutable operation and the owner's persistent session epoch.
 */
class NativeRealtimeManager(private val factory: RealtimeSocketFactory) {
    private val lock = Any()
    private val lifecycle = RealtimeLifecycle()
    private class Connection(val ticket: RealtimeTicket, val driver: RealtimeSocketDriver, val closeFlow: () -> Unit) {
        fun dispose() { driver.removeAllHandlers(); driver.disconnect() }
    }
    private var active: Connection? = null
    val status: RealtimeStatus get() = synchronized(lock) { lifecycle.status }

    /** Call synchronously before session/logout/background async work. */
    fun bind(scope: RealtimeScope?, foreground: Boolean) = synchronized(lock) {
        if (lifecycle.bind(scope, foreground)) {
            val previous = active; active = null
            previous?.dispose(); previous?.closeFlow()
        }
    }
    fun connect(scope: RealtimeScope, bearer: String): Flow<RealtimeEvent> = open(scope, bearer, null)
    /** Owner first awaits real REST authorization, then passes the same reconnect ticket. */
    fun reconnect(ticket: RealtimeTicket, bearer: String): Flow<RealtimeEvent> = open(ticket.scope, bearer, ticket)

    private fun open(scope: RealtimeScope, bearer: String, reconnect: RealtimeTicket?): Flow<RealtimeEvent> = callbackFlow {
        var connection: Connection? = null
        synchronized(lock) {
            if (reconnect != null && !lifecycle.canReconnect(reconnect)) { close(); return@synchronized }
            val ticket = lifecycle.begin(scope)
            if (ticket == null) { close(); return@synchronized }
            val previous = active; active = null
            previous?.dispose(); previous?.closeFlow()
            try {
                val socket = factory.create(RealtimeConnectionOptions(scope, bearer))
                val current = Connection(ticket, socket) { close() }
                active = current; connection = current
                fun lost() = synchronized(lock) {
                    if (lifecycle.disconnected(ticket)) {
                        current.dispose()
                        trySend(RealtimeEvent.RevalidationRequired(ticket))
                        close()
                    }
                }
                socket.onConnected {
                    synchronized(lock) {
                        if (lifecycle.connected(ticket)) trySend(RealtimeEvent.SyncRequired(scope))
                    }
                }
                socket.onDisconnected { lost() }
                socket.onError { lost() }
                socket.onSyncRequired { payload ->
                    synchronized(lock) {
                        if (lifecycle.wake(ticket, payload)) trySend(RealtimeEvent.SyncRequired(scope))
                    }
                }
                socket.connect()
            } catch (_: Exception) {
                // Driver failures never expose bearer-bearing configuration or raw errors.
                connection?.dispose()
                if (lifecycle.disconnected(ticket)) trySend(RealtimeEvent.RevalidationRequired(ticket))
                close()
            }
        }
        awaitClose {
            synchronized(lock) {
                val current = connection
                if (current != null) {
                    if (active === current) {
                        active = null
                        if (!lifecycle.canReconnect(current.ticket)) lifecycle.close(current.ticket)
                    }
                    current.dispose()
                }
            }
        }
    }
}
