package chat.rogi.rogichat.channelport.core.data.repository

import chat.rogi.rogichat.channelport.core.domain.repository.ConsoleSongLiveSocketService
import chat.rogi.rogichat.channelport.core.domain.repository.ConsoleSocketEvent
import chat.rogi.rogichat.channelport.core.network.socket.SongLiveEvent
import chat.rogi.rogichat.channelport.core.network.socket.SongLiveSocketManagerFactory
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.map

class ConsoleSongLiveSocketServiceImpl constructor(
    private val socketManagerFactory: SongLiveSocketManagerFactory,
) : ConsoleSongLiveSocketService {

    override fun connect(identifier: String): Flow<ConsoleSocketEvent> {
        val socketManager = socketManagerFactory.create()
        return socketManager.connect(identifier).map { event ->
            when (event) {
                is SongLiveEvent.Joined -> ConsoleSocketEvent.Connected
                is SongLiveEvent.SessionStarted -> ConsoleSocketEvent.SessionStarted(event.sessionId)
                is SongLiveEvent.SessionEnded -> ConsoleSocketEvent.SessionEnded(event.sessionId)
                is SongLiveEvent.SettingsUpdated -> ConsoleSocketEvent.SettingsUpdated(event.sessionId)
                is SongLiveEvent.RequestAdded -> ConsoleSocketEvent.RequestAdded(event.sessionId)
                is SongLiveEvent.RequestUpdated -> ConsoleSocketEvent.RequestUpdated(event.sessionId)
                is SongLiveEvent.RequestRemoved -> ConsoleSocketEvent.RequestRemoved(event.sessionId, null)
                is SongLiveEvent.QueueReordered -> ConsoleSocketEvent.QueueReordered(event.sessionId)
            }
        }
    }
}
