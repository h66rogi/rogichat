package chat.rogi.rogichat.channelport.core.data.repository

import chat.rogi.rogichat.channelport.core.domain.repository.SongLiveSocketEvent
import chat.rogi.rogichat.channelport.core.domain.repository.SongLiveSocketService
import chat.rogi.rogichat.channelport.core.network.socket.SongLiveEvent
import chat.rogi.rogichat.channelport.core.network.socket.SongLiveSocketManagerFactory
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.map

class SongLiveSocketServiceImpl constructor(
    private val socketManagerFactory: SongLiveSocketManagerFactory,
) : SongLiveSocketService {

    override fun connect(identifier: String): Flow<SongLiveSocketEvent> {
        val socketManager = socketManagerFactory.create()
        return socketManager.connect(identifier).map { event ->
            when (event) {
                is SongLiveEvent.Joined -> SongLiveSocketEvent.Joined(event.session)
                is SongLiveEvent.SessionStarted,
                is SongLiveEvent.SessionEnded,
                is SongLiveEvent.SettingsUpdated,
                is SongLiveEvent.RequestAdded,
                is SongLiveEvent.RequestUpdated,
                is SongLiveEvent.RequestRemoved,
                is SongLiveEvent.QueueReordered -> SongLiveSocketEvent.StateChanged
            }
        }
    }
}
