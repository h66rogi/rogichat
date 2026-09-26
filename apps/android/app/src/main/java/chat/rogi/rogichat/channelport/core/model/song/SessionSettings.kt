package chat.rogi.rogichat.channelport.core.model.song

import kotlinx.serialization.Serializable

// MARK: - Domain Model

data class SessionSettings(
    val id: Int,
    val requestEnabled: Boolean,
    val chatRequestEnabled: Boolean,
    val donationRequestEnabled: Boolean,
    val paused: Boolean,
    val requestCommand: String,
    val maxQueueSize: Int,
    val donationPriorityEnabled: Boolean,
    val requireSongMatch: Boolean,
    val preventDuplicateSongs: Boolean,
    val maxRequestsPerUser: Int,
    val maxTotalRequests: Int,
    val blockedCategoryIds: List<Int>,
    val karaokePlaybackMode: String,
    val karaokeVideoType: String,
    val showRequesterName: Boolean,
)

// MARK: - DTO

@Serializable
data class SessionSettingsDto(
    val id: Int = 0,
    val requestEnabled: Boolean = true,
    val chatRequestEnabled: Boolean = false,
    val donationRequestEnabled: Boolean = false,
    val paused: Boolean = false,
    val requestCommand: String = "!신청",
    val maxQueueSize: Int = 50,
    val donationPriorityEnabled: Boolean = false,
    val requireSongMatch: Boolean = true,
    val preventDuplicateSongs: Boolean = false,
    val maxRequestsPerUser: Int = 0,
    val maxTotalRequests: Int = 50,
    val blockedCategoryIds: List<Int> = emptyList(),
    val karaokePlaybackMode: String = "YOUTUBE",
    val karaokeVideoType: String = "KARAOKE",
    val showRequesterName: Boolean = true,
) {
    fun toDomain(): SessionSettings = SessionSettings(
        id = id,
        requestEnabled = requestEnabled,
        chatRequestEnabled = chatRequestEnabled,
        donationRequestEnabled = donationRequestEnabled,
        paused = paused,
        requestCommand = requestCommand,
        maxQueueSize = maxQueueSize,
        donationPriorityEnabled = donationPriorityEnabled,
        requireSongMatch = requireSongMatch,
        preventDuplicateSongs = preventDuplicateSongs,
        maxRequestsPerUser = maxRequestsPerUser,
        maxTotalRequests = maxTotalRequests,
        blockedCategoryIds = blockedCategoryIds,
        karaokePlaybackMode = karaokePlaybackMode,
        karaokeVideoType = karaokeVideoType,
        showRequesterName = showRequesterName,
    )
}

@Serializable
data class UpdateSettingsPayload(
    val requestEnabled: Boolean? = null,
    val chatRequestEnabled: Boolean? = null,
    val donationRequestEnabled: Boolean? = null,
    val paused: Boolean? = null,
    val requestCommand: String? = null,
    val maxQueueSize: Int? = null,
    val donationPriorityEnabled: Boolean? = null,
    val requireSongMatch: Boolean? = null,
    val preventDuplicateSongs: Boolean? = null,
    val maxRequestsPerUser: Int? = null,
    val maxTotalRequests: Int? = null,
    val blockedCategoryIds: List<Int>? = null,
    val karaokePlaybackMode: String? = null,
    val karaokeVideoType: String? = null,
    val showRequesterName: Boolean? = null,
)
