package chat.rogi.rogichat.channelport.core.model.song

import kotlinx.serialization.Serializable

data class PublicLiveSession(
    val sessionId: Int?,
    val isLive: Boolean,
    val settings: PublicLiveSessionSettings?,
    val queueCount: Int,
)

data class PublicLiveSessionSettings(
    val requestEnabled: Boolean,
    val paused: Boolean,
    val requestCommand: String,
    val maxQueueSize: Int,
    val donationPriorityEnabled: Boolean,
    val chatRequestEnabled: Boolean,
    val donationRequestEnabled: Boolean,
    val requireSongMatch: Boolean,
    val preventDuplicateSongs: Boolean = false,
    val blockedCategoryIds: List<Int> = emptyList(),
    val karaokePlaybackMode: String? = null,
    val karaokeVideoType: String? = null,
    val requestMode: String = "EVERYONE",
)

data class SongRequest(
    val id: Int,
    val liveSessionId: Int,
    val songId: Int? = null,
    val rawArtist: String,
    val rawTitle: String,
    val requesterPlatformId: String,
    val requesterNickname: String,
    val status: String,
    val source: String,
    val queueOrder: Int,
)

@Serializable
data class PublicLiveSessionResponseDto(
    val sessionId: Int? = null,
    val isLive: Boolean = false,
    val settings: PublicLiveSessionSettingsDto? = null,
    val queueCount: Int = 0,
) {
    fun toDomain(): PublicLiveSession = PublicLiveSession(
        sessionId = sessionId,
        isLive = isLive,
        settings = settings?.toDomain(),
        queueCount = queueCount,
    )
}

@Serializable
data class PublicLiveSessionSettingsDto(
    val requestEnabled: Boolean = false,
    val paused: Boolean = false,
    val requestCommand: String = "!신청",
    val maxQueueSize: Int = 0,
    val donationPriorityEnabled: Boolean = true,
    val chatRequestEnabled: Boolean = true,
    val donationRequestEnabled: Boolean = true,
    val requireSongMatch: Boolean = true,
    val preventDuplicateSongs: Boolean = false,
    val blockedCategoryIds: List<Int> = emptyList(),
    val karaokePlaybackMode: String? = null,
    val karaokeVideoType: String? = null,
    val requestMode: String = "EVERYONE",
) {
    fun toDomain(): PublicLiveSessionSettings = PublicLiveSessionSettings(
        requestEnabled = requestEnabled,
        paused = paused,
        requestCommand = requestCommand,
        maxQueueSize = maxQueueSize,
        donationPriorityEnabled = donationPriorityEnabled,
        chatRequestEnabled = chatRequestEnabled,
        donationRequestEnabled = donationRequestEnabled,
        requireSongMatch = requireSongMatch,
        preventDuplicateSongs = preventDuplicateSongs,
        blockedCategoryIds = blockedCategoryIds,
        karaokePlaybackMode = karaokePlaybackMode,
        karaokeVideoType = karaokeVideoType,
        requestMode = requestMode,
    )
}

@Serializable
data class CreateSongRequestPayload(
    val liveSessionId: Int,
    val songId: Int? = null,
    val rawArtist: String,
    val rawTitle: String,
    val rawMessage: String? = null,
    val requesterPlatformId: String,
    val requesterNickname: String,
    val source: String = "MANUAL",
    val donationAmount: Int? = null,
    val donationNativeAmount: Int? = null,
    val donationCurrency: String? = null,
)

@Serializable
data class SongRequestDto(
    val id: Int,
    val liveSessionId: Int,
    val songId: Int? = null,
    val rawArtist: String,
    val rawTitle: String,
    val requesterPlatformId: String,
    val requesterNickname: String,
    val status: String,
    val source: String,
    val queueOrder: Int = 0,
) {
    fun toDomain(): SongRequest = SongRequest(
        id = id,
        liveSessionId = liveSessionId,
        songId = songId,
        rawArtist = rawArtist,
        rawTitle = rawTitle,
        requesterPlatformId = requesterPlatformId,
        requesterNickname = requesterNickname,
        status = status,
        source = source,
        queueOrder = queueOrder,
    )
}

data class SongRequestQueueItem(
    val id: Int,
    val rawArtist: String,
    val rawTitle: String,
    val requesterNickname: String,
    val status: String,
    val queueOrder: Int,
    val songTitle: String?,
    val songArtistName: String?,
    val songAlbumArt: String?,
)

@Serializable
data class SongRequestQueueItemDto(
    val id: Int,
    val rawArtist: String,
    val rawTitle: String,
    val requesterNickname: String,
    val status: String,
    val queueOrder: Int = 0,
    val song: SongRequestSongDto? = null,
) {
    fun toDomain(): SongRequestQueueItem = SongRequestQueueItem(
        id = id,
        rawArtist = rawArtist,
        rawTitle = rawTitle,
        requesterNickname = requesterNickname,
        status = status,
        queueOrder = queueOrder,
        songTitle = song?.title,
        songArtistName = song?.artist?.name,
        songAlbumArt = song?.albumArt,
    )
}

@Serializable
data class SongRequestSongDto(
    val id: Int,
    val title: String,
    val artist: SongRequestArtistDto? = null,
    val albumArt: String? = null,
)

@Serializable
data class SongRequestArtistDto(
    val id: Int,
    val name: String,
)

@Serializable
data class RequestedSongIdsResponseDto(
    val songIds: List<Int> = emptyList(),
)

@Serializable
data class SongRequestQueueResponseDto(
    val requests: List<SongRequestQueueItemDto> = emptyList(),
    val total: Int = 0,
)
