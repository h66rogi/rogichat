package chat.rogi.rogichat.channelport.core.network.api

import chat.rogi.rogichat.channelport.core.model.song.UpdateSongRequest
import chat.rogi.rogichat.channelport.core.model.channel.UpdateChannelRequest
import chat.rogi.rogichat.channelport.core.network.dto.UpdateScheduleRequest
import kotlinx.serialization.json.*

/** Rogichat distinguishes an omitted field from an explicit clear operation. */
internal object ChannelWriteBodies {
    private val json = Json { encodeDefaults = true; explicitNulls = false }
    private fun withClears(value: JsonObject, keys: List<String>) = JsonObject(value.toMutableMap().apply {
        keys.forEach { if (!containsKey(it)) put(it, JsonNull) }
    })
    fun song(value: UpdateSongRequest) = withClears(json.encodeToJsonElement(value).jsonObject,
        listOf("difficulty", "albumArt", "songKey", "bpm", "karaokeUrl", "originalUrl", "coverUrl", "lyricsLink", "lyricsText"))
    fun schedule(value: UpdateScheduleRequest) = withClears(json.encodeToJsonElement(value).jsonObject,
        listOf("content", "endAt", "location", "externalUrl"))
    fun channel(value: UpdateChannelRequest): JsonObject = JsonObject(json.encodeToJsonElement(value).jsonObject.toMutableMap().apply {
        if (!containsKey("profileImageUrl")) put("profileImageUrl", JsonNull)
        put("additionalLinks", JsonArray(value.additionalLinks.map { link -> buildJsonObject {
            put("name", link.name); put("url", link.url)
        } }))
    })
}
