package chat.rogi.rogichat.channelport.core.domain.repository

import chat.rogi.rogichat.channelport.core.model.song.PublicLiveSession
import kotlinx.coroutines.flow.Flow

sealed class SongLiveSocketEvent {
    data class Joined(val session: PublicLiveSession?) : SongLiveSocketEvent()
    data object StateChanged : SongLiveSocketEvent()
}

interface SongLiveSocketService {
    fun connect(identifier: String): Flow<SongLiveSocketEvent>
}
