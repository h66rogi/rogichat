package chat.rogi.rogichat.channelport.core.data.repository

import chat.rogi.rogichat.channelport.core.domain.repository.SongRepository
import chat.rogi.rogichat.channelport.core.domain.repository.SongsResult
import chat.rogi.rogichat.channelport.core.model.song.AlbumArtImage
import chat.rogi.rogichat.channelport.core.model.song.Artist
import chat.rogi.rogichat.channelport.core.model.song.Category
import chat.rogi.rogichat.channelport.core.model.song.CreateSongRequest
import chat.rogi.rogichat.channelport.core.model.song.Song
import chat.rogi.rogichat.channelport.core.model.song.UpdateSongRequest
import chat.rogi.rogichat.channelport.core.network.api.FavoritesApi
import chat.rogi.rogichat.channelport.core.network.api.SongApi
import timber.log.Timber

class SongRepositoryImpl constructor(
    private val songApi: SongApi,
    private val favoritesApi: FavoritesApi,
) : SongRepository {

    override suspend fun getSongs(
        channelId: Int,
        page: Int,
        limit: Int,
        search: String?,
        categoryId: Int?,
        artistId: Int?,
        difficulty: Int?,
        favoritesOnly: Boolean,
        sortBy: String,
    ): Result<SongsResult> = runCatching {
        if (favoritesOnly) {
            val result = favoritesApi.getFavoriteSongs(channelId, page, limit)
            SongsResult(
                songs = result.songs.map { it.toDomain() },
                hasMorePages = result.page * result.limit < result.total,
            )
        } else {
            val result = songApi.getSongs(
                channelId = channelId,
                page = page,
                limit = limit,
                search = search,
                categoryId = categoryId,
                artistId = artistId,
                difficulty = difficulty,
                sortBy = sortBy,
            )
            SongsResult(
                songs = result.songs,
                hasMorePages = result.hasMorePages,
            )
        }
    }.onFailure { Timber.e(it, "Failed to get songs") }

    override suspend fun getSong(channelIdentifier: String, songId: Int): Result<Song> = runCatching {
        songApi.getSong(channelIdentifier, songId)
    }.onFailure { Timber.e(it, "Failed to get song") }

    override suspend fun getCategories(channelIdentifier: String): Result<List<Category>> = runCatching {
        songApi.getCategories(channelIdentifier)
    }.onFailure { Timber.e(it, "Failed to get categories") }

    override suspend fun getArtists(channelIdentifier: String): Result<List<Artist>> = runCatching {
        songApi.getArtists(channelIdentifier)
    }.onFailure { Timber.e(it, "Failed to get artists") }

    override suspend fun createSong(channelId: Int, request: CreateSongRequest): Result<Song> = runCatching {
        songApi.createSong(channelId, request)
    }.onFailure { Timber.e(it, "Failed to create song") }

    override suspend fun updateSong(
        channelIdentifier: String,
        songId: Int,
        request: UpdateSongRequest,
    ): Result<Song> = runCatching {
        songApi.updateSong(channelIdentifier, songId, request)
    }.onFailure { Timber.e(it, "Failed to update song") }

    override suspend fun deleteSong(channelIdentifier: String, songId: Int): Result<Unit> = runCatching {
        songApi.deleteSong(channelIdentifier, songId)
    }.onFailure { Timber.e(it, "Failed to delete song") }

    override suspend fun searchAlbumArt(title: String, artist: String): Result<List<AlbumArtImage>> = runCatching {
        songApi.searchAlbumArt(title, artist)
    }.onFailure { Timber.e(it, "Failed to search album art") }
}
