package chat.rogi.rogichat.channelport.core.model.channel

import kotlinx.serialization.SerialName
import kotlinx.serialization.Serializable

// MARK: - Channel Verification Summary (per-platform)
data class ChannelVerificationSummary(
    val platform: String,
)

// MARK: - Domain Model
data class Channel(
    val id: Int,
    val name: String,
    val webPath: String,
    val platformUrl: String? = null,
    val profileImageUrl: String? = null,
    val topBannerUrl: String? = null,
    val themeColor: String = "#6366f1",
    val channelDescription: String? = null,
    val additionalLinks: List<ChannelLink> = emptyList(),
    val songCount: Int = 0,
    val artistCount: Int = 0,
    val categoryCount: Int = 0,
    val favoritesCount: Int = 0,
    val createdAt: String? = null,
    val updatedAt: String? = null,
    val isOwnerProSubscriber: Boolean = false,
    val verifications: List<ChannelVerificationSummary>? = null,
    val voiceCommissionActive: Boolean = false,
)

@Serializable
data class ChannelLink(
    val id: Int? = null,
    val name: String,
    val url: String,
    val icon: String? = null,
)

@Serializable
data class ChannelWardrobeResponse(
    val categories: List<ChannelWardrobeCategory> = emptyList(),
    val items: List<ChannelWardrobeItem> = emptyList(),
)

@Serializable
data class ChannelWardrobeCategory(
    val id: Int,
    val name: String,
    val defaultAspectRatio: String = "1:1",
    val isEnabled: Boolean = true,
    val order: Int = 0,
)

@Serializable
data class ChannelWardrobeItem(
    val id: Int,
    val categoryId: Int,
    val title: String,
    val imageUrl: String,
    val description: String? = null,
    val tags: List<String> = emptyList(),
    val isVisible: Boolean = true,
    val order: Int = 0,
    val createdAt: String? = null,
    val updatedAt: String? = null,
)

// MARK: - Channel Verification DTO (API Response)
@Serializable
data class ChannelVerificationDTO(
    val platform: String,
)

// MARK: - Channel DTO (API Response)
@Serializable
data class ChannelDTO(
    val id: Int,
    val name: String,
    val webPath: String,
    val platformUrl: String? = null,
    val profileImageUrl: String? = null,
    val topBannerUrl: String? = null,
    val leftBannerUrl: String? = null,
    val rightBannerUrl: String? = null,
    val additionalLinks: List<ChannelLink>? = null,
    val themeColor: String? = null,
    val channelDescription: String? = null,
    val createdAt: String? = null,
    val updatedAt: String? = null,
    @SerialName("_count")
    val count: ChannelCountDTO? = null,
    // Direct fields from popular channels API
    val favoritesCount: Int? = null,
    val songsCount: Int? = null,
    val isOwnerProSubscriber: Boolean? = null,
    val verifications: List<ChannelVerificationDTO>? = null,
    val voiceCommissionActive: Boolean? = null,
) {
    fun toDomain(): Channel = Channel(
        id = id,
        name = name,
        webPath = webPath,
        platformUrl = platformUrl,
        profileImageUrl = profileImageUrl,
        topBannerUrl = topBannerUrl,
        themeColor = themeColor ?: "#6366f1",
        channelDescription = channelDescription,
        additionalLinks = additionalLinks ?: emptyList(),
        songCount = songsCount ?: count?.songs ?: 0,
        artistCount = count?.artists ?: 0,
        categoryCount = count?.categories ?: 0,
        favoritesCount = this.favoritesCount ?: count?.userFavorites ?: 0,
        createdAt = createdAt,
        updatedAt = updatedAt,
        isOwnerProSubscriber = isOwnerProSubscriber ?: false,
        verifications = verifications?.map { ChannelVerificationSummary(platform = it.platform) },
        voiceCommissionActive = voiceCommissionActive ?: false,
    )
}

@Serializable
data class ChannelCountDTO(
    val songs: Int? = null,
    val artists: Int? = null,
    val categories: Int? = null,
    val userFavorites: Int? = null,
)

// MARK: - Favorite Channel DTO (API Response for /v1/favorites/channels)
@Serializable
data class FavoriteChannelDTO(
    val id: Int,
    val channelId: Int,
    val channelName: String,
    val profileImageUrl: String? = null,
    val webPath: String,
    val themeColor: String = "#6366f1",
    val ownerNickname: String? = null,
    val createdAt: String? = null,
    val songCount: Int? = null,
    val artistCount: Int? = null,
    val favoritesCount: Int? = null,
    val isOwnerProSubscriber: Boolean? = null,
) {
    fun toDomain(): Channel = Channel(
        id = channelId,
        name = channelName,
        webPath = webPath,
        profileImageUrl = profileImageUrl,
        themeColor = themeColor,
        songCount = songCount ?: 0,
        artistCount = artistCount ?: 0,
        favoritesCount = favoritesCount ?: 0,
        createdAt = createdAt,
        isOwnerProSubscriber = isOwnerProSubscriber ?: false,
    )
}

// MARK: - My Channel (채널 소유/관리 정보)
data class MyChannel(
    val id: Int,
    val name: String,
    val webPath: String,
    val profileImageUrl: String? = null,
    val themeColor: String = "#6366f1",
    val isOwner: Boolean,
)

@Serializable
data class MyChannelDTO(
    val id: Int,
    val name: String,
    val webPath: String,
    val platformUrl: String? = null,
    val profileImageUrl: String? = null,
    val topBannerUrl: String? = null,
    val leftBannerUrl: String? = null,
    val rightBannerUrl: String? = null,
    val additionalLinks: List<ChannelLink>? = null,
    val themeColor: String? = null,
    val channelDescription: String? = null,
    val createdAt: String? = null,
    val updatedAt: String? = null,
    @SerialName("_count")
    val count: ChannelCountDTO? = null,
    val isOwner: Boolean = false,
) {
    fun toDomain(): MyChannel = MyChannel(
        id = id,
        name = name,
        webPath = webPath,
        profileImageUrl = profileImageUrl,
        themeColor = themeColor ?: "#6366f1",
        isOwner = isOwner,
    )
}

// MARK: - Channel Permission
@Serializable
data class ChannelPermission(
    val view: Boolean = true,
    val manageContent: Boolean = false,
    val manageSettings: Boolean = false,
    val isOwner: Boolean = false,
)

// MARK: - Channel Profile DTO (API Response)
@Serializable
data class ChannelProfile(
    val channelId: Int? = null,
    val nickname: String? = null,
    val birthday: String? = null,
    val residence: String? = null,
    val nationality: String? = null,
    val gender: String? = null,
    val heightCm: String? = null,
    val weightKg: String? = null,
    val mbti: String? = null,
    val symbolColor: String? = null,
    val agency: String? = null,
    val affiliatedGroups: List<String>? = null,
    val fandomName: String? = null,
    val religion: String? = null,
    val description: String? = null,
    val homeDescription: String? = null,
    val education: List<String>? = null,
    val alias: List<String>? = null,
    val debutDate: String? = null,
    val broadcastingPlatforms: List<String>? = null,
    val bio: String? = null,
    val links: List<ProfileLink>? = null,
    val updatedAt: String? = null,
    val anniversaries: ProfileAnniversaries? = null,
) {
    // Computed property for display
    val height: String? get() = heightCm
}

@Serializable
data class ProfileLink(
    val label: String? = null,
    val url: String,
    val icon: String? = null,
)

@Serializable
data class ProfileAnniversaries(
    val milestones: ProfileMilestones? = null,
    val birthday: ProfileBirthday? = null,
    val nextUpcomingEvent: ProfileUpcomingEvent? = null,
)

@Serializable
data class ProfileMilestones(
    val daysPassed: Int = 0,
    val nextMilestone: String? = null,
    val daysToMilestone: Int = 0,
)

@Serializable
data class ProfileBirthday(
    val daysUntilBirthday: Int = 0,
    val birthdayDate: String? = null,
)

@Serializable
data class ProfileUpcomingEvent(
    val type: String? = null,
    val label: String? = null,
    val daysUntil: Int = 0,
)

// MARK: - Update Channel Request
@Serializable
data class UpdateChannelRequest(
    val name: String,
    val webPath: String,
    val profileImageUrl: String? = null,
    val additionalLinks: List<ChannelLink> = emptyList(),
    val themeColor: String,
    val channelDescription: String? = null,
)
