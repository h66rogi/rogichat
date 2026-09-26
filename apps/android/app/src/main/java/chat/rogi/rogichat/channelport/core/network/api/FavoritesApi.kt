package chat.rogi.rogichat.channelport.core.network.api

import chat.rogi.rogichat.channelport.core.model.channel.FavoriteChannelDTO
import chat.rogi.rogichat.channelport.core.model.song.SongsResponse
import chat.rogi.rogichat.channelport.core.network.dto.FavoritesResponse
import kotlinx.serialization.Serializable

class FavoritesApi constructor(
    private val apiClient: ApiClient,
) {
    suspend fun getFavoriteChannels(
        page: Int = 1,
        limit: Int = 20,
    ): FavoritesResponse<FavoriteChannelDTO> = apiClient.get("/v1/favorites/channels") {
        url {
            parameters.append("page", page.toString())
            parameters.append("limit", limit.toString())
        }
    }

    suspend fun getFavoriteChannelStatus(channelId: Int): FavoriteStatusResponse =
        apiClient.get("/v1/favorites/channels/$channelId/status")

    suspend fun getFavoriteChannelCount(channelId: Int): FavoriteCountResponse =
        apiClient.get("/v1/favorites/channels/$channelId/count")

    suspend fun addFavoriteChannel(channelId: Int) {
        apiClient.putWithoutResponse("/v1/favorites/channels/$channelId")
    }

    suspend fun removeFavoriteChannel(channelId: Int) {
        apiClient.deleteWithoutResponse("/v1/favorites/channels/$channelId")
    }

    suspend fun getFavoriteSongs(
        channelId: Int,
        page: Int = 1,
        limit: Int = 30,
    ): SongsResponse = apiClient.get("/v1/songs/favorites/by-channel/$channelId") {
        url {
            parameters.append("page", page.toString())
            parameters.append("limit", limit.toString())
        }
    }

    suspend fun addFavoriteSong(songId: Int) {
        apiClient.putWithoutResponse("/v1/favorites/songs/$songId")
    }

    suspend fun removeFavoriteSong(songId: Int) {
        apiClient.deleteWithoutResponse("/v1/favorites/songs/$songId")
    }
}

@Serializable
data class FavoriteStatusResponse(
    val isFavorite: Boolean,
)

@Serializable
data class FavoriteCountResponse(
    val totalFavorites: Int,
)
