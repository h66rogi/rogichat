package chat.rogi.rogichat.channelport.core.network.api

import chat.rogi.rogichat.channelport.core.model.song.Category
import chat.rogi.rogichat.channelport.core.model.song.CategoryDTO
import chat.rogi.rogichat.channelport.core.model.song.CreateCategoryRequest
import chat.rogi.rogichat.channelport.core.model.song.UpdateCategoryRequest
import io.ktor.client.request.setBody
import io.ktor.http.ContentType
import io.ktor.http.contentType

class CategoryApi constructor(
    private val apiClient: ApiClient,
) {
    suspend fun getCategories(channelId: Int): List<Category> =
        apiClient.get<List<CategoryDTO>>("/v1/categories/channel/$channelId/categories")
            .map { it.toDomain() }

    suspend fun createCategory(channelId: Int, request: CreateCategoryRequest): Category =
        apiClient.post<CategoryDTO>("/v1/categories/channel/$channelId/categories") {
            contentType(ContentType.Application.Json)
            setBody(request)
        }.toDomain()

    suspend fun updateCategory(channelId: Int, categoryId: Int, request: UpdateCategoryRequest): Category =
        apiClient.put<CategoryDTO>("/v1/categories/channel/$channelId/categories/$categoryId") {
            contentType(ContentType.Application.Json)
            setBody(request)
        }.toDomain()

    suspend fun deleteCategory(channelId: Int, categoryId: Int) =
        apiClient.deleteWithoutResponse("/v1/categories/channel/$channelId/categories/$categoryId")
}
