package chat.rogi.rogichat.feature.channel

import kotlinx.serialization.SerialName
import kotlinx.serialization.Serializable

// MARK: - Domain Model
data class Song(
    val id: Int,
    val title: String,
    val artist: Artist? = null,
    val albumArt: String? = null,
    val karaokeUrl: String? = null,
    val coverUrl: String? = null,
    val originalUrl: String? = null,
    val difficulty: Int? = null,
    val proficiency: Int? = null,
    val songKey: String? = null,
    val bpm: Int? = null,
    val lyricsLink: String? = null,
    val lyricsText: String? = null,
    val description: String? = null,
    val price: Int? = null,
    val currencyPrices: Map<String, Int?>? = null,
    val categories: List<Category> = emptyList(),
    val isLiked: Boolean = false,
    val likeCount: Int = 0,
    val createdAt: String? = null,
)

data class Artist(
    val id: Int,
    val name: String,
    val imageUrl: String? = null,
    val songCount: Int = 0,
)

data class Category(
    val id: Int,
    val name: String,
    val color: String? = null,
    val price: Int? = null,
    val currencyPrices: Map<String, Int?>? = null,
    val songCount: Int = 0,
    val displayOrder: Int? = null,
)

// MARK: - Song DTO (API Response)
@Serializable
data class SongDTO(
    val id: Int,
    val title: String,
    val artist: ArtistDTO? = null,
    val albumArt: String? = null,
    val karaokeUrl: String? = null,
    val coverUrl: String? = null,
    val originalUrl: String? = null,
    val difficulty: Int? = null,
    val proficiency: Int? = null,
    val songKey: String? = null,
    val bpm: Int? = null,
    val lyricsLink: String? = null,
    val lyricsText: String? = null,
    val description: String? = null,
    val price: Int? = null,
    val currencyPrices: Map<String, Int?>? = null,
    val songCategories: List<SongCategoryDTO>? = null,
    val isLiked: Boolean? = null,
    val isFavorite: Boolean? = null,
    val totalFavorites: Int? = null,
    @SerialName("_count")
    val count: SongCountDTO? = null,
    val createdAt: String? = null,
) {
    fun toDomain(): Song = Song(
        id = id,
        title = title,
        artist = artist?.toDomain(),
        albumArt = albumArt,
        karaokeUrl = karaokeUrl,
        coverUrl = coverUrl,
        originalUrl = originalUrl,
        difficulty = difficulty,
        proficiency = proficiency,
        songKey = songKey,
        bpm = bpm,
        lyricsLink = lyricsLink,
        lyricsText = lyricsText,
        description = description,
        price = price,
        currencyPrices = currencyPrices,
        categories = songCategories?.map { it.category.toDomain() } ?: emptyList(),
        isLiked = isFavorite ?: isLiked ?: false,
        likeCount = count?.userLikes ?: totalFavorites ?: 0,
        createdAt = createdAt,
    )
}

@Serializable
data class ArtistDTO(
    val id: Int,
    val name: String,
    val imageUrl: String? = null,
    val songCount: Int? = null,
) {
    fun toDomain(): Artist = Artist(
        id = id,
        name = name,
        imageUrl = imageUrl,
        songCount = songCount ?: 0,
    )
}

@Serializable
data class SongCategoryDTO(
    val category: CategoryDTO,
)

@Serializable
data class CategoryDTO(
    val id: Int,
    val name: String,
    val color: String? = null,
    val price: Int? = null,
    val currencyPrices: Map<String, Int?>? = null,
    val songCount: Int? = null,
    @SerialName("displayOrder")
    val displayOrder: Int? = null,
    @SerialName("_count")
    val count: CategoryCountDTO? = null,
) {
    fun toDomain(): Category = Category(
        id = id,
        name = name,
        color = color,
        price = price,
        currencyPrices = currencyPrices,
        songCount = songCount ?: count?.songCategories ?: 0,
        displayOrder = displayOrder,
    )
}

@Serializable
data class CategoryCountDTO(
    val songCategories: Int? = null,
)

// MARK: - Category Management Requests
@Serializable
data class CreateCategoryRequest(
    val name: String,
    val color: String,
    val displayOrder: Int? = null,
)

@Serializable
data class UpdateCategoryRequest(
    val name: String? = null,
    val color: String? = null,
    val displayOrder: Int? = null,
)

@Serializable
data class SongCountDTO(
    val userLikes: Int? = null,
)

// MARK: - Songs Response (Paginated)
@Serializable
data class SongsResponse(
    val songs: List<SongDTO> = emptyList(),
    val total: Int = 0,
    val page: Int = 1,
    val limit: Int = 20,
)

// MARK: - Create Song Request
@Serializable
data class CreateSongRequest(
    val title: String,
    val artistName: String? = null,
    val artistId: Int? = null,
    val categoryNames: List<String>? = null,
    val categoryIds: List<Int>? = null,
    val difficulty: Int? = null,
    val albumArt: String? = null,
    val songKey: String? = null,
    val bpm: Int? = null,
    val karaokeUrl: String? = null,
    val originalUrl: String? = null,
    val coverUrl: String? = null,
    val lyricsLink: String? = null,
    val lyricsText: String? = null,
)

// MARK: - Update Song Request
@Serializable
data class UpdateSongRequest(
    val title: String? = null,
    val artistName: String? = null,
    val artistId: Int? = null,
    val categoryNames: List<String>? = null,
    val categoryIds: List<Int>? = null,
    val difficulty: Int? = null,
    val albumArt: String? = null,
    val songKey: String? = null,
    val bpm: Int? = null,
    val karaokeUrl: String? = null,
    val originalUrl: String? = null,
    val coverUrl: String? = null,
    val lyricsLink: String? = null,
    val lyricsText: String? = null,
)

// MARK: - Album Art Search Response
@Serializable
data class AlbumArtSearchResponse(
    val images: List<AlbumArtImage> = emptyList(),
)

@Serializable
data class AlbumArtImage(
    val title: String? = null,
    val imageUrl: String,
    val thumbnailUrl: String? = null,
    val width: Int? = null,
    val height: Int? = null,
)
