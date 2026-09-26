package chat.rogi.rogichat.channelport.core.network.api

import chat.rogi.rogichat.channelport.core.model.song.ConsoleSongRequestDto
import chat.rogi.rogichat.channelport.core.model.song.ConsoleSession
import chat.rogi.rogichat.channelport.core.model.song.ConsoleSessionDto
import chat.rogi.rogichat.channelport.core.model.song.CreateManualRequestPayload
import chat.rogi.rogichat.channelport.core.model.song.ConsoleSongRequest
import chat.rogi.rogichat.channelport.core.model.song.SessionHistoryResponse
import chat.rogi.rogichat.channelport.core.model.song.SessionHistoryResponseDto
import chat.rogi.rogichat.channelport.core.model.song.SessionSettings
import chat.rogi.rogichat.channelport.core.model.song.SessionSettingsDto
import chat.rogi.rogichat.channelport.core.model.song.StartSessionPayload
import chat.rogi.rogichat.channelport.core.model.song.UpdateSettingsPayload
import io.ktor.client.request.setBody
import io.ktor.http.ContentType
import io.ktor.http.contentType

class SessionApi constructor(
    private val apiClient: ApiClient,
) {
    suspend fun startSession(payload: StartSessionPayload): ConsoleSession {
        val response = apiClient.post<ConsoleSessionDto>("/v1/song-live/sessions") {
            contentType(ContentType.Application.Json)
            setBody(payload)
        }
        return response.toDomain()
    }

    suspend fun getActiveSession(identifier: String? = null): ConsoleSession? {
        return try {
            val response = apiClient.getNullable<ConsoleSessionDto>("/v1/song-live/sessions/active") {
                if (identifier != null) {
                    url { parameters.append("identifier", identifier) }
                }
            }
            response?.toDomain()
        } catch (e: ApiException) {
            if (e.statusCode == 404) null else throw e
        }
    }

    suspend fun endSession(sessionId: Int) {
        apiClient.postWithoutResponse("/v1/song-live/sessions/$sessionId/end")
    }

    suspend fun updateSettings(sessionId: Int, payload: UpdateSettingsPayload): SessionSettings {
        val response = apiClient.patch<SessionSettingsDto>("/v1/song-live/sessions/$sessionId") {
            contentType(ContentType.Application.Json)
            setBody(payload)
        }
        return response.toDomain()
    }

    suspend fun createManualRequest(sessionId: Int, payload: CreateManualRequestPayload): ConsoleSongRequest {
        val response = apiClient.post<ConsoleSongRequestDto>("/v1/song-live/sessions/$sessionId/manual-requests") {
            contentType(ContentType.Application.Json)
            setBody(payload)
        }
        return response.toDomain()
    }

    suspend fun getSessionHistory(identifier: String, page: Int = 1, limit: Int = 10): SessionHistoryResponse {
        val response = apiClient.get<SessionHistoryResponseDto>("/v1/song-live/sessions/history") {
            url {
                parameters.append("identifier", identifier)
                parameters.append("page", page.toString())
                parameters.append("limit", limit.toString())
            }
        }
        return response.toDomain()
    }

    suspend fun cloneSession(sessionId: Int, identifier: String): ConsoleSession {
        val response = apiClient.post<ConsoleSessionDto>("/v1/song-live/sessions/$sessionId/clone") {
            url { parameters.append("identifier", identifier) }
        }
        return response.toDomain()
    }
}
