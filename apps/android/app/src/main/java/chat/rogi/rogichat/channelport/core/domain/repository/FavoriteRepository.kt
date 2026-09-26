package chat.rogi.rogichat.channelport.core.domain.repository

import chat.rogi.rogichat.channelport.core.model.channel.Channel
import chat.rogi.rogichat.channelport.core.model.song.Song
import kotlinx.coroutines.flow.Flow

interface FavoriteRepository {
    fun getFavoriteChannels(page: Int = 1, limit: Int = 20): Flow<List<Channel>>
    suspend fun isFavoriteChannel(channelId: Int): Result<Boolean>
    suspend fun getFavoriteChannelCount(channelId: Int): Result<Int>
    suspend fun addFavoriteChannel(channelId: Int): Result<Unit>
    suspend fun removeFavoriteChannel(channelId: Int): Result<Unit>
    suspend fun toggleFavoriteChannel(channelId: Int, currentState: Boolean): Result<Boolean>

    suspend fun getFavoriteSongs(channelId: Int, page: Int, limit: Int): Result<List<Song>>
    suspend fun addFavoriteSong(songId: Int): Result<Unit>
    suspend fun removeFavoriteSong(songId: Int): Result<Unit>
    suspend fun toggleFavoriteSong(songId: Int, currentState: Boolean): Result<Boolean>
}
