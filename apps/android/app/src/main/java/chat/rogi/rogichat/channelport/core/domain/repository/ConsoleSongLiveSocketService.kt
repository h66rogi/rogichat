package chat.rogi.rogichat.channelport.core.domain.repository

import kotlinx.coroutines.flow.Flow

sealed class ConsoleSocketEvent {
    data class SessionStarted(val sessionId: Int) : ConsoleSocketEvent()
    data class SessionEnded(val sessionId: Int) : ConsoleSocketEvent()
    data class SettingsUpdated(val sessionId: Int) : ConsoleSocketEvent()
    data class RequestAdded(val sessionId: Int) : ConsoleSocketEvent()
    data class RequestUpdated(val sessionId: Int) : ConsoleSocketEvent()
    data class RequestRemoved(val sessionId: Int, val requestId: Int?) : ConsoleSocketEvent()
    data class QueueReordered(val sessionId: Int) : ConsoleSocketEvent()
    data object Connected : ConsoleSocketEvent()
    data object Disconnected : ConsoleSocketEvent()
    data object Reconnecting : ConsoleSocketEvent()
}

interface ConsoleSongLiveSocketService {
    fun connect(identifier: String): Flow<ConsoleSocketEvent>
}
