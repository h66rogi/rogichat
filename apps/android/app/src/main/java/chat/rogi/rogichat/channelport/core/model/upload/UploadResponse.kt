package chat.rogi.rogichat.channelport.core.model.upload

import kotlinx.serialization.Serializable

@Serializable
data class UploadImageResponse(
    val imageUrl: String,
    val fileName: String,
)
