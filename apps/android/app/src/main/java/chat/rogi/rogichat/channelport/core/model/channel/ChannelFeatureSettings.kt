package chat.rogi.rogichat.channelport.core.model.channel

import kotlinx.serialization.Serializable

/**
 * 채널 탭 노출/순서/라벨 설정 — meloming_back origin/main
 * GET /v1/channel/{identifier}/feature-settings (공개, 항상 15종 전체 반환).
 * customItems(커스텀 메뉴 page|board)는 네이티브 미지원으로 파싱만 하고 사용하지 않는다.
 */

object ChannelFeatureKeys {
    const val HOME = "home"
    const val BOARD = "board"
    const val MUSICBOOK = "musicbook"
    const val SCHEDULE = "schedule"
    const val GIFT = "gift"
    const val UPBO = "upbo"
    const val CLIP = "clip"
    const val RANKING = "ranking"
    const val CONTENT = "content"
    const val SETLIST = "setlist"
    const val VOICE = "voice"
    const val HOMEWORK_SONG = "homework-song"
    const val GUESTBOOK = "guestbook"
    const val INFO = "info"
    const val WARDROBE = "wardrobe"
}

@Serializable
data class ChannelFeatureSettingItem(
    val key: String = "",
    val label: String? = null,
    val defaultLabel: String? = null,
    val isEnabled: Boolean = true,
    val order: Int = 0,
) {
    val displayLabel: String? get() = label?.takeIf { it.isNotBlank() } ?: defaultLabel
}

@Serializable
data class ChannelFeatureSettingsResponse(
    val items: List<ChannelFeatureSettingItem> = emptyList(),
)
