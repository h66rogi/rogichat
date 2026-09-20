package chat.rogi.rogichat.core.realtime

import io.socket.client.IO
import io.socket.client.Socket
import okhttp3.CookieJar
import okhttp3.OkHttpClient
import org.json.JSONObject

/** Actual Socket.IO 2.1.2 bridge. Parent owns dependency/lockfile integration. */
class SocketIORealtimeFactory : RealtimeSocketFactory {
    // Separate from any REST interceptors/cookie jars. No provider or bearer logging.
    private val client = OkHttpClient.Builder().cookieJar(CookieJar.NO_COOKIES)
        .followRedirects(false).followSslRedirects(false).retryOnConnectionFailure(false).build()
    override fun create(options: RealtimeConnectionOptions): RealtimeSocketDriver {
        val config = IO.Options().apply {
            transports = arrayOf("websocket")
            reconnection = false
            forceNew = true
            multiplex = false
            timeout = 5_000
            path = options.path
            extraHeaders = options.headers
            auth = nativeSocketAuth(options)
            callFactory = client
            webSocketFactory = client
        }
        return SocketIORealtimeDriver(IO.socket(options.origin, config))
    }
}
/** SDK 2.1.2 declares Map<String,String> but encodes it with JSONObject(Map).
 * This single boundary preserves required JSON numeric schemaVersion instead of
 * silently sending the incompatible string "1". No consumer reads values as String.
 */
@Suppress("UNCHECKED_CAST")
internal fun nativeSocketAuth(options: RealtimeConnectionOptions): Map<String, String> =
    options.auth as Map<String, String>

private class SocketIORealtimeDriver(private val socket: Socket) : RealtimeSocketDriver {
    override fun onConnected(callback: () -> Unit) { socket.on(Socket.EVENT_CONNECT) { callback() } }
    override fun onDisconnected(callback: () -> Unit) { socket.on(Socket.EVENT_DISCONNECT) { callback() } }
    override fun onError(callback: () -> Unit) { socket.on(Socket.EVENT_CONNECT_ERROR) { callback() } }
    override fun onSyncRequired(callback: (String) -> Unit) {
        socket.on("sync.required") { args ->
            val body = args.singleOrNull() as? JSONObject
            if (body != null && body.length() == 1 && body.opt("schemaVersion") == 1) {
                callback("{\"schemaVersion\":1}")
            }
        }
    }
    override fun connect() { socket.connect() }
    override fun removeAllHandlers() { socket.off() }
    override fun disconnect() { socket.disconnect() }
}
