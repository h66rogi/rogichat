package chat.rogi.rogichat.feature.channel

import chat.rogi.rogichat.core.network.NativeApi
import kotlinx.serialization.Serializable
import kotlinx.serialization.json.Json

// Copied/adapted from meloming-android ecb3dbed ChannelApi and ChannelRepositoryImpl.
// The endpoint catalog is bound to Rogichat's one channel and preserves typed DTOs.
class ChannelRepository(private val api: NativeApi) {
    private val json = Json { ignoreUnknownKeys = true; isLenient = false }

    suspend fun getChannel(): Channel =
        json.decodeFromString<ChannelDTO>(api.getPublicChannel("channel/h66rogi")).toDomain()

    suspend fun getFeatureSettings(): ChannelFeatureSettingsResponse =
        json.decodeFromString(api.getPublicChannel("channel/h66rogi/feature-settings"))

    suspend fun getProfile(): ChannelProfile =
        json.decodeFromString(api.getPublicChannel("channel/1/profile"))

    suspend fun getWardrobe(): ChannelWardrobeResponse =
        json.decodeFromString(api.getPublicChannel("channel/h66rogi/wardrobe"))

    suspend fun getFavoritesCount(): ChannelFavoritesCountResponse =
        json.decodeFromString(api.getPublicChannel("favorites/channels/1/count"))

    suspend fun getSongs(page: Int = 1, search: String = "", categoryId: Int? = null,
                         artistId: Int? = null, difficulty: Int? = null): SongsResponse =
        json.decodeFromString(api.getPublicChannel("songs/channel/h66rogi", buildMap {
            put("page", page.coerceAtLeast(1).toString()); put("limit", "40")
            search.takeIf { it.isNotBlank() }?.let { put("search", it) }
            categoryId?.let { put("categoryId", it.toString()) }
            artistId?.let { put("artistId", it.toString()) }
            difficulty?.let { put("difficulty", it.toString()) }
        }))

    suspend fun getCategories(): List<Category> =
        json.decodeFromString<List<CategoryDTO>>(api.getPublicChannel("categories/public/h66rogi"))
            .map(CategoryDTO::toDomain)

    suspend fun getArtists(): List<Artist> =
        json.decodeFromString<List<ArtistDTO>>(api.getPublicChannel("artists/public/h66rogi"))
            .map(ArtistDTO::toDomain)

    suspend fun getSchedules(yearMonth: String): SchedulesResponse {
        require(yearMonth.matches(Regex("[0-9]{4}-(0[1-9]|1[0-2])")))
        return json.decodeFromString(api.getPublicChannel("schedules/channel/1", mapOf("ym" to yearMonth)))
    }

    suspend fun getSetlists(page: Int = 1): ChannelSetlistsResponse =
        json.decodeFromString(api.getPublicChannel("song-live/public/setlists",
            mapOf("identifier" to "h66rogi", "page" to page.coerceAtLeast(1).toString())))

    suspend fun getSetlist(sessionId: Int): ChannelSetlistDetail {
        require(sessionId > 0)
        return json.decodeFromString(api.getPublicChannel("song-live/public/setlists/$sessionId", mapOf("identifier" to "h66rogi")))
    }
}

@Serializable data class ChannelSetlistsResponse(val setlists: List<ChannelSetlistSummary>, val total: Int = 0)
@Serializable data class ChannelFavoritesCountResponse(val totalFavorites: Int)
@Serializable data class ChannelSetlistSummary(val sessionId: Int, val startedAt: String, val completedCount: Int)
@Serializable data class ChannelSetlistDetail(val summary: ChannelSetlistSummary, val songs: List<ChannelSetlistSong>)
@Serializable data class ChannelSetlistSong(val id: Int, val title: String, val artist: String)
