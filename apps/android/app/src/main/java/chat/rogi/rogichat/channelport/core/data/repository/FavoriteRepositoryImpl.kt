package chat.rogi.rogichat.channelport.core.data.repository

import chat.rogi.rogichat.channelport.core.domain.repository.FavoriteRepository
import chat.rogi.rogichat.channelport.core.model.channel.Channel
import chat.rogi.rogichat.channelport.core.model.song.Song
import chat.rogi.rogichat.channelport.core.network.api.FavoritesApi
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.flow
import timber.log.Timber

class FavoriteRepositoryImpl constructor(
    private val favoritesApi: FavoritesApi,
) : FavoriteRepository {

    override fun getFavoriteChannels(page: Int, limit: Int): Flow<List<Channel>> = flow {
        try {
            val response = favoritesApi.getFavoriteChannels(page, limit)
            emit(response.items.map { it.toDomain() })
        } catch (e: Exception) {
            Timber.e(e, "Failed to get favorite channels")
            emit(emptyList())
        }
    }

    override suspend fun isFavoriteChannel(channelId: Int): Result<Boolean> = runCatching {
        favoritesApi.getFavoriteChannelStatus(channelId).isFavorite
    }.onFailure { Timber.e(it, "Failed to check favorite status") }

    override suspend fun getFavoriteChannelCount(channelId: Int): Result<Int> = runCatching {
        favoritesApi.getFavoriteChannelCount(channelId).totalFavorites
    }.onFailure { Timber.e(it, "Failed to get favorite channel count") }

    override suspend fun addFavoriteChannel(channelId: Int): Result<Unit> = runCatching {
        favoritesApi.addFavoriteChannel(channelId)
    }.onFailure { Timber.e(it, "Failed to add favorite channel") }

    override suspend fun removeFavoriteChannel(channelId: Int): Result<Unit> = runCatching {
        favoritesApi.removeFavoriteChannel(channelId)
    }.onFailure { Timber.e(it, "Failed to remove favorite channel") }

    override suspend fun toggleFavoriteChannel(channelId: Int, currentState: Boolean): Result<Boolean> = runCatching {
        if (currentState) {
            favoritesApi.removeFavoriteChannel(channelId)
            false
        } else {
            favoritesApi.addFavoriteChannel(channelId)
            true
        }
    }.onFailure { Timber.e(it, "Failed to toggle favorite channel") }

    override suspend fun getFavoriteSongs(channelId: Int, page: Int, limit: Int): Result<List<Song>> = runCatching {
        favoritesApi.getFavoriteSongs(channelId, page, limit).songs.map { it.toDomain() }
    }.onFailure { Timber.e(it, "Failed to get favorite songs") }

    override suspend fun addFavoriteSong(songId: Int): Result<Unit> = runCatching {
        favoritesApi.addFavoriteSong(songId)
    }.onFailure { Timber.e(it, "Failed to add favorite song") }

    override suspend fun removeFavoriteSong(songId: Int): Result<Unit> = runCatching {
        favoritesApi.removeFavoriteSong(songId)
    }.onFailure { Timber.e(it, "Failed to remove favorite song") }

    override suspend fun toggleFavoriteSong(songId: Int, currentState: Boolean): Result<Boolean> = runCatching {
        if (currentState) {
            favoritesApi.removeFavoriteSong(songId)
            false
        } else {
            favoritesApi.addFavoriteSong(songId)
            true
        }
    }.onFailure { Timber.e(it, "Failed to toggle favorite song") }
}
