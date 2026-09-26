package chat.rogi.rogichat.channelport.core.network.dto

import kotlinx.serialization.Serializable

@Serializable
data class CreateScheduleRequest(
    val title: String,
    val startAt: String,
    val endAt: String? = null,
    val allDay: Boolean = false,
    val status: String = "TBD",
    val visibility: String = "PUBLIC",
    val location: String? = null,
    val externalUrl: String? = null,
    val content: String? = null,
)
