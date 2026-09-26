package chat.rogi.rogichat.channelport.core.domain.repository

import chat.rogi.rogichat.channelport.core.model.song.AlbumArtImage
import chat.rogi.rogichat.channelport.core.model.song.Artist
import chat.rogi.rogichat.channelport.core.model.song.Category
import chat.rogi.rogichat.channelport.core.model.song.CreateSongRequest
import chat.rogi.rogichat.channelport.core.model.song.Song
import chat.rogi.rogichat.channelport.core.model.song.UpdateSongRequest

data class SongsResult(
    val songs: List<Song>,
    val hasMorePages: Boolean,
)

interface SongRepository {
    suspend fun getSongs(
        channelId: Int,
        page: Int = 1,
        limit: Int = 30,
        search: String? = null,
        categoryId: Int? = null,
        artistId: Int? = null,
        difficulty: Int? = null,
        favoritesOnly: Boolean = false,
        sortBy: String = "newest",
    ): Result<SongsResult>

    suspend fun getSong(channelIdentifier: String, songId: Int): Result<Song>

    suspend fun getCategories(channelIdentifier: String): Result<List<Category>>

    suspend fun getArtists(channelIdentifier: String): Result<List<Artist>>

    suspend fun createSong(channelId: Int, request: CreateSongRequest): Result<Song>

    suspend fun updateSong(channelIdentifier: String, songId: Int, request: UpdateSongRequest): Result<Song>

    suspend fun deleteSong(channelIdentifier: String, songId: Int): Result<Unit>

    suspend fun searchAlbumArt(title: String, artist: String): Result<List<AlbumArtImage>>
}
