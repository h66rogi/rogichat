package chat.rogi.rogichat.channelport.core.domain.repository

import chat.rogi.rogichat.channelport.core.model.song.ClearQueueResponse
import chat.rogi.rogichat.channelport.core.model.song.ConsoleSongRequest
import chat.rogi.rogichat.channelport.core.model.song.CreateSongRequestPayload
import chat.rogi.rogichat.channelport.core.model.song.PublicLiveSession
import chat.rogi.rogichat.channelport.core.model.song.SongRequest
import chat.rogi.rogichat.channelport.core.model.song.SongRequestQueueItem
import chat.rogi.rogichat.channelport.core.model.song.UpdateSongRequestStatusPayload

interface SongRequestRepository {
    suspend fun getPublicActiveSession(identifier: String): Result<PublicLiveSession>
    suspend fun createSongRequest(request: CreateSongRequestPayload): Result<SongRequest>
    suspend fun getRequestedSongIds(sessionId: Int): Result<List<Int>>
    suspend fun getQueue(sessionId: Int): Result<List<SongRequestQueueItem>>

    // Console methods
    suspend fun getConsoleQueue(sessionId: Int, includeCompleted: Boolean = false): Result<List<ConsoleSongRequest>>
    suspend fun getNowPlaying(sessionId: Int): Result<ConsoleSongRequest?>
    suspend fun playNext(sessionId: Int): Result<ConsoleSongRequest?>
    suspend fun skipCurrent(sessionId: Int, reason: String? = null): Result<ConsoleSongRequest?>
    suspend fun playNow(requestId: Int): Result<ConsoleSongRequest>
    suspend fun updateStatus(requestId: Int, payload: UpdateSongRequestStatusPayload): Result<ConsoleSongRequest>
    suspend fun updateOrder(requestId: Int, newOrder: Int): Result<Unit>
    suspend fun deleteRequest(requestId: Int): Result<Unit>
    suspend fun clearQueue(sessionId: Int): Result<ClearQueueResponse>
}
