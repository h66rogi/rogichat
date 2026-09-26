package chat.rogi.rogichat.channelport.core.data.repository

import chat.rogi.rogichat.channelport.core.domain.repository.SessionRepository
import chat.rogi.rogichat.channelport.core.model.song.ConsoleSongRequest
import chat.rogi.rogichat.channelport.core.model.song.ConsoleSession
import chat.rogi.rogichat.channelport.core.model.song.CreateManualRequestPayload
import chat.rogi.rogichat.channelport.core.model.song.SessionHistoryResponse
import chat.rogi.rogichat.channelport.core.model.song.SessionSettings
import chat.rogi.rogichat.channelport.core.model.song.StartSessionPayload
import chat.rogi.rogichat.channelport.core.model.song.UpdateSettingsPayload
import chat.rogi.rogichat.channelport.core.network.api.SessionApi
import timber.log.Timber

class SessionRepositoryImpl constructor(
    private val sessionApi: SessionApi,
) : SessionRepository {

    override suspend fun startSession(payload: StartSessionPayload): Result<ConsoleSession> = runCatching {
        sessionApi.startSession(payload)
    }.onFailure {
        Timber.e(it, "Failed to start session")
    }

    override suspend fun getActiveSession(identifier: String?): Result<ConsoleSession?> = runCatching {
        sessionApi.getActiveSession(identifier)
    }.onFailure {
        Timber.e(it, "Failed to get active session")
    }

    override suspend fun endSession(sessionId: Int): Result<Unit> = runCatching {
        sessionApi.endSession(sessionId)
    }.onFailure {
        Timber.e(it, "Failed to end session: $sessionId")
    }

    override suspend fun updateSettings(sessionId: Int, payload: UpdateSettingsPayload): Result<SessionSettings> = runCatching {
        sessionApi.updateSettings(sessionId, payload)
    }.onFailure {
        Timber.e(it, "Failed to update settings: sessionId=$sessionId")
    }

    override suspend fun createManualRequest(sessionId: Int, payload: CreateManualRequestPayload): Result<ConsoleSongRequest> = runCatching {
        sessionApi.createManualRequest(sessionId, payload)
    }.onFailure {
        Timber.e(it, "Failed to create manual request: sessionId=$sessionId")
    }

    override suspend fun getSessionHistory(identifier: String, page: Int, limit: Int): Result<SessionHistoryResponse> = runCatching {
        sessionApi.getSessionHistory(identifier, page, limit)
    }.onFailure {
        Timber.e(it, "Failed to get session history")
    }

    override suspend fun cloneSession(sessionId: Int, identifier: String): Result<ConsoleSession> = runCatching {
        sessionApi.cloneSession(sessionId, identifier)
    }.onFailure {
        Timber.e(it, "Failed to clone session: $sessionId")
    }
}
