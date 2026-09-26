package chat.rogi.rogichat.channelport.core.network.dto

import kotlinx.serialization.SerialName
import kotlinx.serialization.Serializable

@Serializable
data class PaginatedResponse<T>(
    val items: List<T>,
    val total: Int = 0,
    val page: Int = 1,
    val limit: Int = 20,
    val totalPages: Int = 1,
)

@Serializable
data class CursorPaginatedResponse<T>(
    val items: List<T>,
    val nextCursor: String? = null,
    val total: Int = 0,
) {
    val hasNextPage: Boolean get() = nextCursor != null
}

@Serializable
data class FavoritesResponse<T>(
    @SerialName("favorites")
    val items: List<T>,
    val total: Int = 0,
    val page: Int = 1,
    val limit: Int = 20,
    val totalPages: Int = 1,
)

@Serializable
data class NewsPaginatedResponse<T>(
    val items: List<T>,
    val meta: NewsPaginationMeta = NewsPaginationMeta(),
)

@Serializable
data class NewsPaginationMeta(
    val page: Int = 1,
    val pageSize: Int = 12,
    val total: Int = 0,
    val totalPages: Int = 1,
)
