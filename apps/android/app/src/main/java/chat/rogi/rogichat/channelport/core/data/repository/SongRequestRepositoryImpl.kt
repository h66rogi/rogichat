package chat.rogi.rogichat.channelport.core.data.repository

import chat.rogi.rogichat.channelport.core.domain.repository.SongRequestRepository
import chat.rogi.rogichat.channelport.core.model.song.ClearQueueResponse
import chat.rogi.rogichat.channelport.core.model.song.ConsoleSongRequest
import chat.rogi.rogichat.channelport.core.model.song.CreateSongRequestPayload
import chat.rogi.rogichat.channelport.core.model.song.PublicLiveSession
import chat.rogi.rogichat.channelport.core.model.song.SongRequest
import chat.rogi.rogichat.channelport.core.model.song.SongRequestQueueItem
import chat.rogi.rogichat.channelport.core.model.song.UpdateSongRequestStatusPayload
import chat.rogi.rogichat.channelport.core.network.api.SongRequestApi
import timber.log.Timber

class SongRequestRepositoryImpl constructor(
    private val songRequestApi: SongRequestApi,
) : SongRequestRepository {

    override suspend fun getPublicActiveSession(identifier: String): Result<PublicLiveSession> = runCatching {
        songRequestApi.getPublicActiveSession(identifier)
    }.onFailure {
        Timber.e(it, "Failed to get public active session: $identifier")
    }

    override suspend fun createSongRequest(request: CreateSongRequestPayload): Result<SongRequest> = runCatching {
        songRequestApi.createSongRequest(request)
    }.onFailure {
        Timber.e(it, "Failed to create song request: liveSessionId=${request.liveSessionId}, songId=${request.songId}")
    }

    override suspend fun getRequestedSongIds(sessionId: Int): Result<List<Int>> = runCatching {
        songRequestApi.getRequestedSongIds(sessionId)
    }.onFailure {
        Timber.e(it, "Failed to get requested song ids: sessionId=$sessionId")
    }

    override suspend fun getQueue(sessionId: Int): Result<List<SongRequestQueueItem>> = runCatching {
        songRequestApi.getQueue(sessionId)
    }.onFailure {
        Timber.e(it, "Failed to get song request queue: sessionId=$sessionId")
    }

    // Console methods

    override suspend fun getConsoleQueue(sessionId: Int, includeCompleted: Boolean): Result<List<ConsoleSongRequest>> = runCatching {
        songRequestApi.getConsoleQueue(sessionId, includeCompleted)
    }.onFailure {
        Timber.e(it, "Failed to get console queue: sessionId=$sessionId")
    }

    override suspend fun getNowPlaying(sessionId: Int): Result<ConsoleSongRequest?> = runCatching {
        songRequestApi.getNowPlaying(sessionId)
    }.onFailure {
        Timber.e(it, "Failed to get now playing: sessionId=$sessionId")
    }

    override suspend fun playNext(sessionId: Int): Result<ConsoleSongRequest?> = runCatching {
        songRequestApi.playNext(sessionId)
    }.onFailure {
        Timber.e(it, "Failed to play next: sessionId=$sessionId")
    }

    override suspend fun skipCurrent(sessionId: Int, reason: String?): Result<ConsoleSongRequest?> = runCatching {
        songRequestApi.skipCurrent(sessionId, reason)
    }.onFailure {
        Timber.e(it, "Failed to skip current: sessionId=$sessionId")
    }

    override suspend fun playNow(requestId: Int): Result<ConsoleSongRequest> = runCatching {
        songRequestApi.playNow(requestId)
    }.onFailure {
        Timber.e(it, "Failed to play now: requestId=$requestId")
    }

    override suspend fun updateStatus(requestId: Int, payload: UpdateSongRequestStatusPayload): Result<ConsoleSongRequest> = runCatching {
        songRequestApi.updateStatus(requestId, payload)
    }.onFailure {
        Timber.e(it, "Failed to update status: requestId=$requestId")
    }

    override suspend fun updateOrder(requestId: Int, newOrder: Int): Result<Unit> = runCatching {
        songRequestApi.updateOrder(requestId, newOrder)
        Unit
    }.onFailure {
        Timber.e(it, "Failed to update order: requestId=$requestId, newOrder=$newOrder")
    }

    override suspend fun deleteRequest(requestId: Int): Result<Unit> = runCatching {
        songRequestApi.deleteRequest(requestId)
    }.onFailure {
        Timber.e(it, "Failed to delete request: requestId=$requestId")
    }

    override suspend fun clearQueue(sessionId: Int): Result<ClearQueueResponse> = runCatching {
        songRequestApi.clearQueue(sessionId)
    }.onFailure {
        Timber.e(it, "Failed to clear queue: sessionId=$sessionId")
    }
}
