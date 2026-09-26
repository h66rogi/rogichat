package chat.rogi.rogichat.channelport.core.model.schedule

import kotlinx.serialization.SerialName
import kotlinx.serialization.Serializable

// MARK: - Domain Model
data class Schedule(
    val id: Int,
    val title: String,
    val description: String? = null,
    val scheduleType: ScheduleType = ScheduleType.TBD,
    val startAt: String,
    val endAt: String? = null,
    val allDay: Boolean = false,
    val isCanceled: Boolean = false,
    val isPublic: Boolean = true,
    val location: String? = null,
    val externalUrl: String? = null,
    val channel: ScheduleChannelSummary? = null,
    val createdAt: String? = null,
)

data class ScheduleChannelSummary(
    val id: Int,
    val name: String,
    val webPath: String,
    val profileImageUrl: String? = null,
    val themeColor: String = "#3B82F6",
)

enum class ScheduleType(
    val displayName: String,
) {
    LIVE("방송시작"),
    COLLAB("합방"),
    OFF("휴방"),
    ETC("기타"),
    TBD("미정");

    companion object {
        fun fromString(value: String): ScheduleType {
            return entries.find { it.name == value.uppercase() } ?: TBD
        }
    }
}

// MARK: - Schedule DTO (API Response)
@Serializable
data class ScheduleDTO(
    val id: Int,
    val channelId: Int? = null,
    val channelWebPath: String? = null,
    val author: ScheduleAuthorDTO? = null,
    val channel: ScheduleChannelDTO? = null,
    val title: String,
    val content: String? = null,
    val startAt: String,
    val endAt: String? = null,
    val allDay: Boolean = false,
    val isCanceled: Boolean = false,
    val visibility: String? = null,
    val status: String? = null,
    val location: String? = null,
    val externalUrl: String? = null,
    val createdAt: String? = null,
    val updatedAt: String? = null,
) {
    fun toDomain(): Schedule = Schedule(
        id = id,
        title = title,
        description = content,
        scheduleType = ScheduleType.fromString(status ?: "TBD"),
        startAt = startAt,
        endAt = endAt,
        allDay = allDay,
        isCanceled = isCanceled,
        isPublic = visibility?.uppercase() == "PUBLIC",
        location = location,
        externalUrl = externalUrl,
        channel = channel?.toSummary(),
        createdAt = createdAt,
    )
}

@Serializable
data class ScheduleAuthorDTO(
    val id: Int,
    val nickname: String? = null,
    val profileImageUrl: String? = null,
)

@Serializable
data class ScheduleChannelDTO(
    val id: Int,
    val name: String,
    val profileImageUrl: String? = null,
    val webPath: String,
    val themeColor: String? = null,
) {
    fun toSummary(): ScheduleChannelSummary = ScheduleChannelSummary(
        id = id,
        name = name,
        webPath = webPath,
        profileImageUrl = profileImageUrl,
        themeColor = themeColor ?: "#3B82F6",
    )
}

// MARK: - Schedules Response
@Serializable
data class SchedulesResponse(
    val items: List<ScheduleDTO> = emptyList(),
    val page: Int = 1,
    val limit: Int = 20,
    val total: Int = 0,
)
