package chat.rogi.rogichat.channelport.core.model.song

import kotlinx.serialization.Serializable

// MARK: - Domain Model (콘솔용 전체 필드)

data class ConsoleSongRequest(
    val id: Int,
    val liveSessionId: Int,
    val songId: Int?,
    val rawArtist: String,
    val rawTitle: String,
    val rawMessage: String?,
    val requesterPlatformId: String,
    val requesterNickname: String,
    val status: String,
    val source: String,
    val donationAmount: Int?,
    val donationNativeAmount: Int? = null,
    val donationCurrency: String? = null,
    val priority: Int,
    val queueOrder: Int,
    val playedAt: String?,
    val completedAt: String?,
    val rejectionReason: String?,
    val createdAt: String,
    val updatedAt: String,
    val song: ConsoleSongInfo?,
    val calculatedPrice: Int?,
    val priceSource: String?,
    val formattedPrice: String?,
) {
    val displayTitle: String get() = song?.title ?: rawTitle
    val displayArtist: String get() = song?.artist?.name ?: rawArtist
    val albumArt: String? get() = song?.albumArt

    val isCompleted: Boolean get() = status == "COMPLETED"
    val isRejected: Boolean get() = status == "REJECTED"
    val isPending: Boolean get() = status == "PENDING"
    val isPlaying: Boolean get() = status == "PLAYING"
    val isDonation: Boolean get() = source == "DONATION"
}

data class ConsoleSongInfo(
    val id: Int,
    val title: String,
    val albumArt: String?,
    val karaokeUrl: String?,
    val coverUrl: String?,
    val originalUrl: String?,
    val difficulty: Int?,
    val songKey: String?,
    val bpm: Int?,
    val artist: ConsoleSongArtist?,
)

data class ConsoleSongArtist(
    val id: Int,
    val name: String,
)

// MARK: - DTOs

@Serializable
data class ConsoleSongRequestDto(
    val id: Int,
    val liveSessionId: Int,
    val songId: Int? = null,
    val rawArtist: String,
    val rawTitle: String,
    val rawMessage: String? = null,
    val requesterPlatformId: String = "",
    val requesterNickname: String = "",
    val status: String,
    val source: String = "CHAT",
    val donationAmount: Int? = null,
    val donationNativeAmount: Int? = null,
    val donationCurrency: String? = null,
    val priority: Int = 0,
    val queueOrder: Int = 0,
    val playedAt: String? = null,
    val completedAt: String? = null,
    val rejectionReason: String? = null,
    val createdAt: String = "",
    val updatedAt: String = "",
    val song: ConsoleSongInfoDto? = null,
    val calculatedPrice: Int? = null,
    val priceSource: String? = null,
    val formattedPrice: String? = null,
) {
    fun toDomain(): ConsoleSongRequest = ConsoleSongRequest(
        id = id,
        liveSessionId = liveSessionId,
        songId = songId,
        rawArtist = rawArtist,
        rawTitle = rawTitle,
        rawMessage = rawMessage,
        requesterPlatformId = requesterPlatformId,
        requesterNickname = requesterNickname,
        status = status,
        source = source,
        donationAmount = donationAmount,
        donationNativeAmount = donationNativeAmount,
        donationCurrency = donationCurrency,
        priority = priority,
        queueOrder = queueOrder,
        playedAt = playedAt,
        completedAt = completedAt,
        rejectionReason = rejectionReason,
        createdAt = createdAt,
        updatedAt = updatedAt,
        song = song?.toDomain(),
        calculatedPrice = calculatedPrice,
        priceSource = priceSource,
        formattedPrice = formattedPrice,
    )
}

@Serializable
data class ConsoleSongInfoDto(
    val id: Int,
    val title: String,
    val albumArt: String? = null,
    val karaokeUrl: String? = null,
    val coverUrl: String? = null,
    val originalUrl: String? = null,
    val difficulty: Int? = null,
    val songKey: String? = null,
    val bpm: Int? = null,
    val artist: ConsoleSongArtistDto? = null,
) {
    fun toDomain(): ConsoleSongInfo = ConsoleSongInfo(
        id = id,
        title = title,
        albumArt = albumArt,
        karaokeUrl = karaokeUrl,
        coverUrl = coverUrl,
        originalUrl = originalUrl,
        difficulty = difficulty,
        songKey = songKey,
        bpm = bpm,
        artist = artist?.toDomain(),
    )
}

@Serializable
data class ConsoleSongArtistDto(
    val id: Int,
    val name: String,
) {
    fun toDomain(): ConsoleSongArtist = ConsoleSongArtist(id = id, name = name)
}

@Serializable
data class ConsoleQueueResponseDto(
    val requests: List<ConsoleSongRequestDto> = emptyList(),
    val total: Int = 0,
)

@Serializable
data class CreateManualRequestPayload(
    val rawArtist: String,
    val rawTitle: String,
    val songId: Int? = null,
    val rawMessage: String? = null,
)

@Serializable
data class UpdateSongRequestStatusPayload(
    val status: String,
    val rejectionReason: String? = null,
)

@Serializable
data class UpdateQueueOrderResponse(
    val message: String = "",
)

@Serializable
data class ClearQueueResponse(
    val deletedCount: Int = 0,
    val message: String = "",
)
