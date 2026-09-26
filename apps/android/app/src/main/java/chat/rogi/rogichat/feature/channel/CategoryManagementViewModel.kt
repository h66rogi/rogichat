package chat.rogi.rogichat.feature.channel

import androidx.lifecycle.SavedStateHandle
import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import chat.rogi.rogichat.channelport.core.domain.repository.CategoryRepository
import chat.rogi.rogichat.channelport.core.model.song.Category
import chat.rogi.rogichat.channelport.core.model.song.CreateCategoryRequest
import chat.rogi.rogichat.channelport.core.model.song.UpdateCategoryRequest
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch

data class CategoryManagementUiState(
    val isLoading: Boolean = true,
    val categories: List<Category> = emptyList(),
    val error: String? = null,
    val isSaving: Boolean = false,
    val searchQuery: String = "",
)

sealed interface CategoryManagementEvent {
    data object Refresh : CategoryManagementEvent
    data class SearchQueryChanged(val query: String) : CategoryManagementEvent
    data class CreateCategory(val name: String, val color: String) : CategoryManagementEvent
    data class UpdateCategory(val categoryId: Int, val name: String, val color: String) : CategoryManagementEvent
    data class DeleteCategory(val categoryId: Int) : CategoryManagementEvent
    data class ReorderCategories(val categories: List<Category>) : CategoryManagementEvent
    data object ErrorDismissed : CategoryManagementEvent
}

class CategoryManagementViewModel constructor(
    savedStateHandle: SavedStateHandle,
    private val categoryRepository: CategoryRepository,
) : ViewModel() {

    private val channelId: Int = checkNotNull(savedStateHandle["channelId"])

    private val _uiState = MutableStateFlow(CategoryManagementUiState())
    val uiState: StateFlow<CategoryManagementUiState> = _uiState.asStateFlow()

    init {
        loadCategories()
    }

    fun onEvent(event: CategoryManagementEvent) {
        when (event) {
            CategoryManagementEvent.Refresh -> loadCategories()
            is CategoryManagementEvent.SearchQueryChanged -> {
                _uiState.update { it.copy(searchQuery = event.query) }
            }
            is CategoryManagementEvent.CreateCategory -> createCategory(event.name, event.color)
            is CategoryManagementEvent.UpdateCategory -> updateCategory(event.categoryId, event.name, event.color)
            is CategoryManagementEvent.DeleteCategory -> deleteCategory(event.categoryId)
            is CategoryManagementEvent.ReorderCategories -> reorderCategories(event.categories)
            CategoryManagementEvent.ErrorDismissed -> {
                _uiState.update { it.copy(error = null) }
            }
        }
    }

    private fun loadCategories() {
        viewModelScope.launch {
            _uiState.update { it.copy(isLoading = true) }

            categoryRepository.getCategories(channelId)
                .onSuccess { categories ->
                    val sortedCategories = sortCategories(categories)
                    _uiState.update {
                        it.copy(isLoading = false, categories = sortedCategories)
                    }
                }
                .onFailure { exception ->
                    _uiState.update {
                        it.copy(
                            isLoading = false,
                            error = exception.message ?: "카테고리를 불러오는데 실패했습니다",
                        )
                    }
                }
        }
    }

    private fun createCategory(name: String, color: String) {
        viewModelScope.launch {
            _uiState.update { it.copy(isSaving = true) }

            // 새 카테고리의 displayOrder 계산 (프론트엔드와 동일한 로직)
            // maxOrder > 0 이면 maxOrder + 1, 아니면 1000
            val maxOrder = _uiState.value.categories
                .mapNotNull { it.displayOrder }
                .filter { it > 0 }
                .maxOrNull() ?: 0
            val newDisplayOrder = if (maxOrder > 0) maxOrder + 1 else 1000

            val request = CreateCategoryRequest(
                name = name,
                color = color,
                displayOrder = newDisplayOrder,
            )

            categoryRepository.createCategory(channelId, request)
                .onSuccess {
                    _uiState.update { it.copy(isSaving = false) }
                    loadCategories()
                }
                .onFailure { exception ->
                    _uiState.update {
                        it.copy(
                            isSaving = false,
                            error = exception.message ?: "카테고리 생성에 실패했습니다",
                        )
                    }
                }
        }
    }

    private fun updateCategory(categoryId: Int, name: String, color: String) {
        viewModelScope.launch {
            _uiState.update { it.copy(isSaving = true) }

            val request = UpdateCategoryRequest(name = name, color = color)

            categoryRepository.updateCategory(channelId, categoryId, request)
                .onSuccess {
                    _uiState.update { it.copy(isSaving = false) }
                    loadCategories()
                }
                .onFailure { exception ->
                    _uiState.update {
                        it.copy(
                            isSaving = false,
                            error = exception.message ?: "카테고리 수정에 실패했습니다",
                        )
                    }
                }
        }
    }

    private fun deleteCategory(categoryId: Int) {
        viewModelScope.launch {
            _uiState.update { it.copy(isSaving = true) }

            categoryRepository.deleteCategory(channelId, categoryId)
                .onSuccess {
                    _uiState.update { it.copy(isSaving = false) }
                    loadCategories()
                }
                .onFailure { exception ->
                    _uiState.update {
                        it.copy(
                            isSaving = false,
                            error = exception.message ?: "카테고리 삭제에 실패했습니다",
                        )
                    }
                }
        }
    }

    private fun reorderCategories(categories: List<Category>) {
        viewModelScope.launch {
            // Optimistic update
            _uiState.update { it.copy(categories = categories) }

            // Calculate startOrder: max existing displayOrder + 1, or length * 100 if none exist
            // This matches the frontend implementation exactly
            val maxExistingOrder = categories
                .mapNotNull { it.displayOrder }
                .filter { it > 0 }
                .maxOrNull() ?: 0

            val startOrder = if (maxExistingOrder > 0) {
                maxExistingOrder + 1
            } else {
                categories.size * 100
            }

            // Update all categories with name, color, and displayOrder (matching frontend)
            var successCount = 0
            var failCount = 0

            categories.forEachIndexed { index, category ->
                val newDisplayOrder = startOrder - index
                val request = UpdateCategoryRequest(
                    name = category.name,
                    color = category.color ?: "#6B7280",
                    displayOrder = newDisplayOrder,
                )
                categoryRepository.updateCategory(channelId, category.id, request)
                    .onSuccess { successCount++ }
                    .onFailure { failCount++ }
            }

            // Reload to get server state
            loadCategories()

            // Only show error if ALL updates failed
            if (successCount == 0 && failCount > 0) {
                _uiState.update {
                    it.copy(error = "순서 변경에 실패했습니다")
                }
            }
            // If some succeeded, consider it a success (partial failure is OK)
        }
    }

    private fun sortCategories(categories: List<Category>): List<Category> {
        val collator = java.text.Collator.getInstance(java.util.Locale.KOREAN)
        return categories.sortedWith { a, b ->
            val orderA = a.displayOrder
            val orderB = b.displayOrder

            when {
                orderA != null && orderB != null -> orderB.compareTo(orderA) // 높은 값이 먼저
                orderA != null -> -1 // displayOrder 있는 것이 먼저
                orderB != null -> 1
                else -> collator.compare(a.name, b.name) // 이름 가나다순
            }
        }
    }
}
