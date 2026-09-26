package chat.rogi.rogichat.channelport

import chat.rogi.rogichat.channelport.core.network.api.ApiClient
import io.ktor.client.request.parameter
import kotlinx.serialization.Serializable

@Serializable data class ChannelSetlists(val setlists: List<ChannelSetlistSummary>, val total: Int)
@Serializable data class ChannelSetlistSummary(val sessionId: Int, val startedAt: String, val completedCount: Int, val albumArtPreviews: List<String> = emptyList())
@Serializable data class ChannelSetlistDetail(val summary: ChannelSetlistSummary, val songs: List<ChannelSetlistSong>)
@Serializable data class ChannelSetlistSong(val id: Int, val title: String, val artist: String, val albumArt: String? = null)
class ChannelSetlistRepository(private val api: ApiClient) {
    suspend fun list(page: Int) = api.get<ChannelSetlists>("/v1/song-live/public/setlists") {
        parameter("identifier", "h66rogi"); parameter("page", page)
    }
    suspend fun detail(id: Int) = api.get<ChannelSetlistDetail>("/v1/song-live/public/setlists/$id") { parameter("identifier", "h66rogi") }
}
