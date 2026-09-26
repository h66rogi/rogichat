package chat.rogi.rogichat.channelport.core.network.api

import chat.rogi.rogichat.channelport.core.model.song.AlbumArtImage
import chat.rogi.rogichat.channelport.core.model.song.AlbumArtSearchResponse
import chat.rogi.rogichat.channelport.core.model.song.Artist
import chat.rogi.rogichat.channelport.core.model.song.ArtistDTO
import chat.rogi.rogichat.channelport.core.model.song.Category
import chat.rogi.rogichat.channelport.core.model.song.CategoryDTO
import chat.rogi.rogichat.channelport.core.model.song.CreateSongRequest
import chat.rogi.rogichat.channelport.core.model.song.Song
import chat.rogi.rogichat.channelport.core.model.song.SongDTO
import chat.rogi.rogichat.channelport.core.model.song.SongsResponse
import chat.rogi.rogichat.channelport.core.model.song.UpdateSongRequest
import io.ktor.client.request.setBody
import io.ktor.http.ContentType
import io.ktor.http.contentType
import kotlinx.serialization.Serializable

data class SongsPaginatedResult(
    val songs: List<Song>,
    val total: Int,
    val page: Int,
    val limit: Int,
    val hasMorePages: Boolean,
)

class SongApi constructor(
    private val apiClient: ApiClient,
) {
    suspend fun getSongs(
        channelId: Int,
        page: Int = 1,
        limit: Int = 30,
        search: String? = null,
        categoryId: Int? = null,
        artistId: Int? = null,
        difficulty: Int? = null,
        sortBy: String = "newest",
    ): SongsPaginatedResult {
        val response = apiClient.get<SongsResponse>("/v1/songs/channel/$channelId") {
            url {
                parameters.append("page", page.toString())
                parameters.append("limit", limit.toString())
                parameters.append("sortBy", sortBy)
                search?.let { parameters.append("search", it) }
                categoryId?.let { parameters.append("categoryId", it.toString()) }
                artistId?.let { parameters.append("artistId", it.toString()) }
                difficulty?.let { parameters.append("difficulty", it.toString()) }
            }
        }
        return SongsPaginatedResult(
            songs = response.songs.map { it.toDomain() },
            total = response.total,
            page = response.page,
            limit = response.limit,
            hasMorePages = response.page * response.limit < response.total,
        )
    }

    suspend fun getSong(channelIdentifier: String, songId: Int): Song =
        apiClient.get<SongDTO>("/v1/songs/channel/$channelIdentifier/$songId").toDomain()

    suspend fun getCategories(channelIdentifier: String): List<Category> =
        apiClient.get<List<CategoryDTO>>("/v1/categories/public/$channelIdentifier")
            .map { it.toDomain() }

    suspend fun getArtists(channelIdentifier: String): List<Artist> =
        apiClient.get<List<ArtistDTO>>("/v1/artists/public/$channelIdentifier")
            .map { it.toDomain() }

    suspend fun createSong(channelId: Int, request: CreateSongRequest): Song =
        apiClient.post<SongDTO>("/v1/songs/channel/$channelId") {
            contentType(ContentType.Application.Json)
            setBody(request)
        }.toDomain()

    suspend fun updateSong(channelIdentifier: String, songId: Int, request: UpdateSongRequest): Song =
        apiClient.patch<SongDTO>("/v1/songs/channel/$channelIdentifier/$songId") {
            contentType(ContentType.Application.Json)
            setBody(ChannelWriteBodies.song(request))
        }.toDomain()

    suspend fun deleteSong(channelIdentifier: String, songId: Int) {
        apiClient.deleteWithoutResponse("/v1/songs/channel/$channelIdentifier/$songId")
    }

    suspend fun searchAlbumArt(title: String, artist: String): List<AlbumArtImage> {
        @Serializable
        data class SearchRequest(val title: String, val artist: String)

        return apiClient.post<AlbumArtSearchResponse>("/v1/serper/search") {
            contentType(ContentType.Application.Json)
            setBody(SearchRequest(title, artist))
        }.images
    }
}
