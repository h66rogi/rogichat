package chat.rogi.rogichat.core.conversation

import chat.rogi.rogichat.core.auth.StrictAuthJson
import chat.rogi.rogichat.core.media.*
import chat.rogi.rogichat.core.network.RoomId
import kotlinx.serialization.json.*

/** Same account DB and original M/A scope as the immutable command, with no signed URL or credential. */
data class ConversationMedia(val client: MediaClient, val journal: MediaJournal)
internal fun storedMedia(value: String): MediaContent {
    val body = StrictAuthJson.objectValue(value)
    fun text(key: String) = body.getValue(key).jsonPrimitive.let { require(it.isString); it.content }
    return when (val type = text("type")) {
        "PHOTO", "VIDEO" -> {
            require(body.keys == setOf("type", "assetIds"))
            val ids = body.getValue("assetIds").jsonArray.map { it.jsonPrimitive.let { item -> require(item.isString); RoomId(item.content).value } }
            MediaContent.Attachment(MediaKind.valueOf(type), ids.map { MediaReceipt(it, MediaStatus.ready) })
        }
        "STICKER" -> { require(body.keys == setOf("type", "stickerId")); MediaContent.Sticker(RoomId(text("stickerId")).value) }
        else -> error("invalid_media_command")
    }
}
