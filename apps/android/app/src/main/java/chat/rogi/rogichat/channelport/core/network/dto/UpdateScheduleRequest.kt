package chat.rogi.rogichat.channelport.core.network.dto

import kotlinx.serialization.Serializable

@Serializable
data class UpdateScheduleRequest(
    val title: String? = null,
    val content: String? = null,
    val startAt: String? = null,
    val endAt: String? = null,
    val allDay: Boolean? = null,
    val visibility: String? = null,
    val location: String? = null,
    val externalUrl: String? = null,
    val status: String? = null,
)
