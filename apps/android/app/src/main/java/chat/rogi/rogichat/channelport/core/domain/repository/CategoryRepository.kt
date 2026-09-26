package chat.rogi.rogichat.channelport.core.domain.repository

import chat.rogi.rogichat.channelport.core.model.song.Category
import chat.rogi.rogichat.channelport.core.model.song.CreateCategoryRequest
import chat.rogi.rogichat.channelport.core.model.song.UpdateCategoryRequest

interface CategoryRepository {
    suspend fun getCategories(channelId: Int): Result<List<Category>>

    suspend fun createCategory(channelId: Int, request: CreateCategoryRequest): Result<Category>

    suspend fun updateCategory(channelId: Int, categoryId: Int, request: UpdateCategoryRequest): Result<Category>

    suspend fun deleteCategory(channelId: Int, categoryId: Int): Result<Unit>
}
