package chat.rogi.rogichat.channelport.core.model.song

import kotlinx.serialization.Serializable

// MARK: - Domain Models

data class ConsoleSession(
    val id: Int,
    val channelId: Int,
    val userId: Int,
    val platform: String,
    val platformChannelId: String?,
    val status: String,
    val overlayToken: String,
    val startedAt: String,
    val endedAt: String?,
    val createdAt: String,
    val updatedAt: String,
    val settings: SessionSettings?,
)

// MARK: - DTOs

@Serializable
data class ConsoleSessionDto(
    val id: Int,
    val channelId: Int,
    val userId: Int,
    val platform: String,
    val platformChannelId: String? = null,
    val status: String,
    val overlayToken: String,
    val startedAt: String,
    val endedAt: String? = null,
    val createdAt: String,
    val updatedAt: String,
    val settings: SessionSettingsDto? = null,
) {
    fun toDomain(): ConsoleSession = ConsoleSession(
        id = id,
        channelId = channelId,
        userId = userId,
        platform = platform,
        platformChannelId = platformChannelId,
        status = status,
        overlayToken = overlayToken,
        startedAt = startedAt,
        endedAt = endedAt,
        createdAt = createdAt,
        updatedAt = updatedAt,
        settings = settings?.toDomain(),
    )
}

@Serializable
data class StartSessionPayload(
    val platform: String,
    val platformChannelId: String? = null,
)

// MARK: - Session History

data class SessionHistoryItem(
    val id: Int,
    val platform: String,
    val status: String,
    val startedAt: String,
    val endedAt: String?,
    val duration: Int?,
    val stats: SessionStats,
)

data class SessionStats(
    val totalRequests: Int,
    val completedCount: Int,
    val rejectedCount: Int,
    val totalDonation: Int,
)

data class SessionHistoryResponse(
    val sessions: List<SessionHistoryItem>,
    val pagination: SessionPagination,
)

data class SessionPagination(
    val page: Int,
    val limit: Int,
    val total: Int,
    val totalPages: Int,
)

@Serializable
data class SessionHistoryItemDto(
    val id: Int,
    val platform: String,
    val status: String,
    val startedAt: String,
    val endedAt: String? = null,
    val duration: Int? = null,
    val stats: SessionStatsDto = SessionStatsDto(),
) {
    fun toDomain(): SessionHistoryItem = SessionHistoryItem(
        id = id,
        platform = platform,
        status = status,
        startedAt = startedAt,
        endedAt = endedAt,
        duration = duration,
        stats = stats.toDomain(),
    )
}

@Serializable
data class SessionStatsDto(
    val totalRequests: Int = 0,
    val completedCount: Int = 0,
    val rejectedCount: Int = 0,
    val totalDonation: Int = 0,
) {
    fun toDomain(): SessionStats = SessionStats(
        totalRequests = totalRequests,
        completedCount = completedCount,
        rejectedCount = rejectedCount,
        totalDonation = totalDonation,
    )
}

@Serializable
data class SessionPaginationDto(
    val page: Int = 1,
    val limit: Int = 10,
    val total: Int = 0,
    val totalPages: Int = 0,
) {
    fun toDomain(): SessionPagination = SessionPagination(
        page = page,
        limit = limit,
        total = total,
        totalPages = totalPages,
    )
}

@Serializable
data class SessionHistoryResponseDto(
    val sessions: List<SessionHistoryItemDto> = emptyList(),
    val pagination: SessionPaginationDto = SessionPaginationDto(),
) {
    fun toDomain(): SessionHistoryResponse = SessionHistoryResponse(
        sessions = sessions.map { it.toDomain() },
        pagination = pagination.toDomain(),
    )
}
