package chat.rogi.rogichat.channelport.core.network.socket

import chat.rogi.rogichat.channelport.core.model.song.PublicLiveSession
import chat.rogi.rogichat.channelport.core.model.song.PublicLiveSessionResponseDto
import chat.rogi.rogichat.channelport.core.network.api.BaseUrlProvider
import io.socket.client.IO
import io.socket.client.Socket
import kotlinx.coroutines.channels.awaitClose
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.callbackFlow
import kotlinx.serialization.Serializable
import kotlinx.serialization.json.Json
import org.json.JSONObject
import timber.log.Timber

@Serializable
private data class SongLiveJoinedResponse(
    val channelId: Int? = null,
    val room: String? = null,
    val session: PublicLiveSessionResponseDto? = null,
)

sealed class SongLiveEvent {
    data class Joined(val session: PublicLiveSession?) : SongLiveEvent()
    data class SessionStarted(val sessionId: Int) : SongLiveEvent()
    data class SessionEnded(val sessionId: Int) : SongLiveEvent()
    data class SettingsUpdated(val sessionId: Int) : SongLiveEvent()
    data class RequestAdded(val sessionId: Int) : SongLiveEvent()
    data class RequestUpdated(val sessionId: Int) : SongLiveEvent()
    data class RequestRemoved(val sessionId: Int) : SongLiveEvent()
    data class QueueReordered(val sessionId: Int) : SongLiveEvent()
}

class SongLiveSocketManager(
    private val baseUrlProvider: BaseUrlProvider,
) {
    private val json = Json { ignoreUnknownKeys = true }

    fun connect(identifier: String): Flow<SongLiveEvent> = callbackFlow {
        val baseUrl = baseUrlProvider.getBaseUrl()

        val options = IO.Options().apply {
            transports = arrayOf("websocket", "polling")
            reconnection = true
            timeout = 20_000
        }

        val socket = IO.socket("$baseUrl/song-live", options)

        socket.on(Socket.EVENT_CONNECT) {
            Timber.tag("SongLiveSocket").d("Connected, joining with identifier: $identifier")
            socket.emit("join", JSONObject().put("identifier", identifier))
        }

        socket.on(Socket.EVENT_DISCONNECT) {
            Timber.tag("SongLiveSocket").d("Disconnected")
        }

        socket.on(Socket.EVENT_CONNECT_ERROR) { args ->
            val error = args.firstOrNull()
            Timber.tag("SongLiveSocket").e("Connection error: $error")
        }

        socket.on("joined") { args ->
            try {
                val data = args.firstOrNull()?.toString()
                Timber.tag("SongLiveSocket").d("Joined event received: $data")
                val session = data?.let {
                    json.decodeFromString<SongLiveJoinedResponse>(it).session?.toDomain()
                }
                trySend(SongLiveEvent.Joined(session))
            } catch (e: Exception) {
                Timber.tag("SongLiveSocket").e(e, "Failed to parse joined event")
                trySend(SongLiveEvent.Joined(null))
            }
        }

        val sessionEvents = mapOf(
            "session.started" to { id: Int -> SongLiveEvent.SessionStarted(id) },
            "session.ended" to { id: Int -> SongLiveEvent.SessionEnded(id) },
            "settings.updated" to { id: Int -> SongLiveEvent.SettingsUpdated(id) },
            "request.added" to { id: Int -> SongLiveEvent.RequestAdded(id) },
            "request.updated" to { id: Int -> SongLiveEvent.RequestUpdated(id) },
            "request.removed" to { id: Int -> SongLiveEvent.RequestRemoved(id) },
            "queue.reordered" to { id: Int -> SongLiveEvent.QueueReordered(id) },
        )

        sessionEvents.forEach { (eventName, eventFactory) ->
            socket.on(eventName) { args ->
                try {
                    val data = args.firstOrNull()
                    val sessionId = when (data) {
                        is JSONObject -> data.optInt("sessionId", 0)
                        is Number -> data.toInt()
                        else -> 0
                    }
                    Timber.tag("SongLiveSocket").d("Event: $eventName, sessionId: $sessionId")
                    trySend(eventFactory(sessionId))
                } catch (e: Exception) {
                    Timber.tag("SongLiveSocket").e(e, "Failed to parse event: $eventName")
                }
            }
        }

        socket.connect()
        Timber.tag("SongLiveSocket").d("Socket connecting to $baseUrl/song-live")

        awaitClose {
            Timber.tag("SongLiveSocket").d("Closing socket connection")
            sessionEvents.keys.forEach { socket.off(it) }
            socket.off("joined")
            socket.off(Socket.EVENT_CONNECT)
            socket.off(Socket.EVENT_DISCONNECT)
            socket.off(Socket.EVENT_CONNECT_ERROR)
            socket.disconnect()
        }
    }
}
