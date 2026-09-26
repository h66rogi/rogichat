package chat.rogi.rogichat.channelport.core.network.api

import chat.rogi.rogichat.channelport.core.model.song.ClearQueueResponse
import chat.rogi.rogichat.channelport.core.model.song.ConsoleSongRequest
import chat.rogi.rogichat.channelport.core.model.song.ConsoleSongRequestDto
import chat.rogi.rogichat.channelport.core.model.song.ConsoleQueueResponseDto
import chat.rogi.rogichat.channelport.core.model.song.CreateSongRequestPayload
import chat.rogi.rogichat.channelport.core.model.song.PublicLiveSession
import chat.rogi.rogichat.channelport.core.model.song.PublicLiveSessionResponseDto
import chat.rogi.rogichat.channelport.core.model.song.RequestedSongIdsResponseDto
import chat.rogi.rogichat.channelport.core.model.song.SongRequest
import chat.rogi.rogichat.channelport.core.model.song.SongRequestDto
import chat.rogi.rogichat.channelport.core.model.song.SongRequestQueueItem
import chat.rogi.rogichat.channelport.core.model.song.SongRequestQueueResponseDto
import chat.rogi.rogichat.channelport.core.model.song.UpdateQueueOrderResponse
import chat.rogi.rogichat.channelport.core.model.song.UpdateSongRequestStatusPayload
import io.ktor.client.request.setBody
import io.ktor.http.ContentType
import io.ktor.http.contentType

class SongRequestApi constructor(
    private val apiClient: ApiClient,
) {
    suspend fun getPublicActiveSession(identifier: String): PublicLiveSession {
        val response = apiClient.get<PublicLiveSessionResponseDto>("/v1/song-live/public/active") {
            url {
                parameters.append("identifier", identifier)
            }
        }
        return response.toDomain()
    }

    suspend fun createSongRequest(request: CreateSongRequestPayload): SongRequest {
        val response = apiClient.post<SongRequestDto>("/v1/song-requests") {
            contentType(ContentType.Application.Json)
            setBody(request)
        }
        return response.toDomain()
    }

    suspend fun getRequestedSongIds(sessionId: Int): List<Int> {
        val response = apiClient.get<RequestedSongIdsResponseDto>("/v1/song-requests/requested-song-ids") {
            url {
                parameters.append("sessionId", sessionId.toString())
            }
        }
        return response.songIds
    }

    suspend fun getQueue(sessionId: Int): List<SongRequestQueueItem> {
        val response = apiClient.get<SongRequestQueueResponseDto>("/v1/song-requests") {
            url {
                parameters.append("sessionId", sessionId.toString())
                parameters.append("includeCompleted", "false")
            }
        }
        return response.requests.map { it.toDomain() }
    }

    // MARK: - Console endpoints

    suspend fun getConsoleQueue(sessionId: Int, includeCompleted: Boolean = false): List<ConsoleSongRequest> {
        val response = apiClient.get<ConsoleQueueResponseDto>("/v1/song-requests") {
            url {
                parameters.append("sessionId", sessionId.toString())
                parameters.append("includeCompleted", includeCompleted.toString())
            }
        }
        return response.requests.map { it.toDomain() }
    }

    suspend fun getNowPlaying(sessionId: Int): ConsoleSongRequest? {
        return try {
            apiClient.getNullable<ConsoleSongRequestDto>("/v1/song-requests/now-playing") {
                url {
                    parameters.append("sessionId", sessionId.toString())
                }
            }?.toDomain()
        } catch (e: ApiException) {
            if (e.statusCode == 404) null else throw e
        }
    }

    suspend fun playNext(sessionId: Int): ConsoleSongRequest? {
        return try {
            apiClient.postNullable<ConsoleSongRequestDto>("/v1/song-requests/play-next") {
                url {
                    parameters.append("sessionId", sessionId.toString())
                }
            }?.toDomain()
        } catch (e: ApiException) {
            if (e.statusCode == 404) null else throw e
        }
    }

    suspend fun skipCurrent(sessionId: Int, reason: String? = null): ConsoleSongRequest? {
        return try {
            apiClient.postNullable<ConsoleSongRequestDto>("/v1/song-requests/skip-current") {
                url {
                    parameters.append("sessionId", sessionId.toString())
                    if (reason != null) {
                        parameters.append("reason", reason)
                    }
                }
            }?.toDomain()
        } catch (e: ApiException) {
            if (e.statusCode == 404) null else throw e
        }
    }

    suspend fun playNow(requestId: Int): ConsoleSongRequest {
        val response = apiClient.post<ConsoleSongRequestDto>("/v1/song-requests/$requestId/play-now")
        return response.toDomain()
    }

    suspend fun updateStatus(requestId: Int, payload: UpdateSongRequestStatusPayload): ConsoleSongRequest {
        val response = apiClient.patch<ConsoleSongRequestDto>("/v1/song-requests/$requestId/status") {
            contentType(ContentType.Application.Json)
            setBody(payload)
        }
        return response.toDomain()
    }

    suspend fun updateOrder(requestId: Int, newOrder: Int): UpdateQueueOrderResponse {
        return apiClient.patch<UpdateQueueOrderResponse>("/v1/song-requests/$requestId/order") {
            contentType(ContentType.Application.Json)
            setBody(mapOf("newOrder" to newOrder))
        }
    }

    suspend fun deleteRequest(requestId: Int) {
        apiClient.deleteWithoutResponse("/v1/song-requests/$requestId")
    }

    suspend fun clearQueue(sessionId: Int): ClearQueueResponse {
        return apiClient.delete<ClearQueueResponse>("/v1/song-requests/queue") {
            url {
                parameters.append("sessionId", sessionId.toString())
            }
        }
    }
}
