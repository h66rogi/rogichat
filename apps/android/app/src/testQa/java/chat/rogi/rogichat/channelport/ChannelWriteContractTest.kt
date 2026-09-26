package chat.rogi.rogichat.channelport

import chat.rogi.rogichat.channelport.core.model.channel.ChannelLink
import chat.rogi.rogichat.channelport.core.model.channel.UpdateChannelRequest
import chat.rogi.rogichat.channelport.core.model.song.UpdateSongRequest
import chat.rogi.rogichat.channelport.core.network.api.ChannelWriteBodies
import chat.rogi.rogichat.channelport.core.network.dto.UpdateScheduleRequest
import kotlinx.serialization.json.*
import org.junit.Assert.*
import org.junit.Test

class ChannelWriteContractTest {
    @Test fun songEditsCanClearMetadataAndCategoriesWithoutNullArtistId() {
        val body = ChannelWriteBodies.song(UpdateSongRequest(title = "노래", artistName = "가수", categoryNames = emptyList()))
        assertFalse(body.containsKey("artistId"))
        assertFalse(body.containsKey("categoryIds"))
        assertEquals(JsonArray(emptyList()), body["categoryNames"])
        for (key in listOf("difficulty", "albumArt", "songKey", "bpm", "karaokeUrl", "originalUrl", "coverUrl", "lyricsLink", "lyricsText")) assertEquals(key, JsonNull, body[key])
    }
    @Test fun scheduleEditsClearOptionalFieldsWithoutClearingRequiredOnes() {
        val body = ChannelWriteBodies.schedule(UpdateScheduleRequest(title = "일정", allDay = false))
        assertEquals(JsonPrimitive(false), body["allDay"])
        assertFalse(body.containsKey("startAt"))
        for (key in listOf("content", "endAt", "location", "externalUrl")) assertEquals(key, JsonNull, body[key])
    }
    @Test fun settingsPreserveVisibilityAndWriteOnlySupportedLinkFields() {
        val body = ChannelWriteBodies.channel(UpdateChannelRequest("UNLISTED", "후로기", "h66rogi", null,
            listOf(ChannelLink(id = 9, name = "방송", url = "https://example.com", icon = "link")), "#ff8c9d", ""))
        assertEquals(JsonPrimitive("UNLISTED"), body["visibility"])
        assertEquals(JsonNull, body["profileImageUrl"])
        assertEquals(setOf("name", "url"), body["additionalLinks"]!!.jsonArray[0].jsonObject.keys)
    }
}
