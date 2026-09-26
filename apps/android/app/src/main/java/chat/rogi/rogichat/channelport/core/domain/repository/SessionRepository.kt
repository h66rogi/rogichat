package chat.rogi.rogichat.channelport.core.domain.repository

import chat.rogi.rogichat.channelport.core.model.song.ConsoleSongRequest
import chat.rogi.rogichat.channelport.core.model.song.ConsoleSession
import chat.rogi.rogichat.channelport.core.model.song.CreateManualRequestPayload
import chat.rogi.rogichat.channelport.core.model.song.SessionHistoryResponse
import chat.rogi.rogichat.channelport.core.model.song.SessionSettings
import chat.rogi.rogichat.channelport.core.model.song.StartSessionPayload
import chat.rogi.rogichat.channelport.core.model.song.UpdateSettingsPayload

interface SessionRepository {
    suspend fun startSession(payload: StartSessionPayload): Result<ConsoleSession>
    suspend fun getActiveSession(identifier: String? = null): Result<ConsoleSession?>
    suspend fun endSession(sessionId: Int): Result<Unit>
    suspend fun updateSettings(sessionId: Int, payload: UpdateSettingsPayload): Result<SessionSettings>
    suspend fun createManualRequest(sessionId: Int, payload: CreateManualRequestPayload): Result<ConsoleSongRequest>
    suspend fun getSessionHistory(identifier: String, page: Int = 1, limit: Int = 10): Result<SessionHistoryResponse>
    suspend fun cloneSession(sessionId: Int, identifier: String): Result<ConsoleSession>
}
