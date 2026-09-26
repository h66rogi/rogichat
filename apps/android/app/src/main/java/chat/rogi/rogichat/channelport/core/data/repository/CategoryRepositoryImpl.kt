package chat.rogi.rogichat.channelport.core.data.repository

import chat.rogi.rogichat.channelport.core.domain.repository.CategoryRepository
import chat.rogi.rogichat.channelport.core.model.song.Category
import chat.rogi.rogichat.channelport.core.model.song.CreateCategoryRequest
import chat.rogi.rogichat.channelport.core.model.song.UpdateCategoryRequest
import chat.rogi.rogichat.channelport.core.network.api.CategoryApi
import timber.log.Timber

class CategoryRepositoryImpl constructor(
    private val categoryApi: CategoryApi,
) : CategoryRepository {

    override suspend fun getCategories(channelId: Int): Result<List<Category>> = runCatching {
        categoryApi.getCategories(channelId)
    }.onFailure { Timber.e(it, "Failed to get categories") }

    override suspend fun createCategory(channelId: Int, request: CreateCategoryRequest): Result<Category> = runCatching {
        categoryApi.createCategory(channelId, request)
    }.onFailure { Timber.e(it, "Failed to create category") }

    override suspend fun updateCategory(
        channelId: Int,
        categoryId: Int,
        request: UpdateCategoryRequest,
    ): Result<Category> = runCatching {
        categoryApi.updateCategory(channelId, categoryId, request)
    }.onFailure { Timber.e(it, "Failed to update category") }

    override suspend fun deleteCategory(channelId: Int, categoryId: Int): Result<Unit> = runCatching {
        categoryApi.deleteCategory(channelId, categoryId)
    }.onFailure { Timber.e(it, "Failed to delete category") }
}
