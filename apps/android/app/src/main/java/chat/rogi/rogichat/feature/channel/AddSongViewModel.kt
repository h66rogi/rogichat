package chat.rogi.rogichat.feature.channel

import androidx.lifecycle.SavedStateHandle
import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import chat.rogi.rogichat.channelport.core.domain.repository.SongRepository
import chat.rogi.rogichat.channelport.core.model.song.AlbumArtImage
import chat.rogi.rogichat.channelport.core.model.song.Artist
import chat.rogi.rogichat.channelport.core.model.song.Category
import chat.rogi.rogichat.channelport.core.model.song.CreateSongRequest
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch

data class AddSongUiState(
    val isLoading: Boolean = true,
    val isSubmitting: Boolean = false,
    val isSuccess: Boolean = false,
    val error: String? = null,
    // Form fields
    val title: String = "",
    val artistName: String = "",
    val selectedCategories: Set<String> = emptySet(),
    val newCategoryName: String = "",
    val difficulty: Int = 3,
    val albumArt: String = "",
    val songKey: String = "",
    val bpmString: String = "",
    val karaokeUrl: String = "",
    val originalUrl: String = "",
    val coverUrl: String = "",
    val lyricsLink: String = "",
    val lyricsText: String = "",
    // Data
    val categories: List<Category> = emptyList(),
    val artists: List<Artist> = emptyList(),
    val albumArtResults: List<AlbumArtImage> = emptyList(),
    val isSearchingAlbumArt: Boolean = false,
) {
    val isValid: Boolean
        get() = title.isNotBlank() &&
            artistName.isNotBlank() &&
            (selectedCategories.isNotEmpty() || newCategoryName.isNotBlank())

    val canSearchAlbumArt: Boolean
        get() = title.isNotBlank() && artistName.isNotBlank()

    val filteredArtists: List<Artist>
        get() = if (artistName.isBlank()) {
            emptyList()
        } else {
            artists.filter {
                it.name.contains(artistName, ignoreCase = true) &&
                    it.name != artistName
            }
        }
}

sealed interface AddSongEvent {
    data class TitleChanged(val title: String) : AddSongEvent
    data class ArtistNameChanged(val name: String) : AddSongEvent
    data class ArtistSelected(val artist: Artist) : AddSongEvent
    data class CategoryToggled(val categoryName: String) : AddSongEvent
    data class NewCategoryNameChanged(val name: String) : AddSongEvent
    data class DifficultyChanged(val difficulty: Int) : AddSongEvent
    data class AlbumArtChanged(val url: String) : AddSongEvent
    data class AlbumArtSelected(val url: String) : AddSongEvent
    data class SongKeyChanged(val key: String) : AddSongEvent
    data class BpmChanged(val bpm: String) : AddSongEvent
    data class KaraokeUrlChanged(val url: String) : AddSongEvent
    data class OriginalUrlChanged(val url: String) : AddSongEvent
    data class CoverUrlChanged(val url: String) : AddSongEvent
    data class LyricsLinkChanged(val url: String) : AddSongEvent
    data class LyricsTextChanged(val text: String) : AddSongEvent
    data object SearchAlbumArt : AddSongEvent
}

class AddSongViewModel constructor(
    savedStateHandle: SavedStateHandle,
    private val songRepository: SongRepository,
) : ViewModel() {

    private val channelId: Int = checkNotNull(savedStateHandle["channelId"])
    private val channelIdentifier: String = checkNotNull(savedStateHandle["channelIdentifier"])

    private val _uiState = MutableStateFlow(AddSongUiState())
    val uiState: StateFlow<AddSongUiState> = _uiState.asStateFlow()

    init {
        loadData()
    }

    private fun loadData() {
        viewModelScope.launch {
            _uiState.update { it.copy(isLoading = true) }

            // Load categories and artists in parallel
            val categoriesResult = songRepository.getCategories(channelIdentifier)
            val artistsResult = songRepository.getArtists(channelIdentifier)

            _uiState.update { state ->
                state.copy(
                    isLoading = false,
                    categories = categoriesResult.getOrDefault(emptyList()),
                    artists = artistsResult.getOrDefault(emptyList()),
                )
            }
        }
    }

    fun onEvent(event: AddSongEvent) {
        when (event) {
            is AddSongEvent.TitleChanged -> {
                _uiState.update { it.copy(title = event.title) }
            }
            is AddSongEvent.ArtistNameChanged -> {
                _uiState.update { it.copy(artistName = event.name) }
            }
            is AddSongEvent.ArtistSelected -> {
                _uiState.update { it.copy(artistName = event.artist.name) }
            }
            is AddSongEvent.CategoryToggled -> {
                _uiState.update { state ->
                    val newCategories = if (state.selectedCategories.contains(event.categoryName)) {
                        state.selectedCategories - event.categoryName
                    } else {
                        state.selectedCategories + event.categoryName
                    }
                    state.copy(selectedCategories = newCategories)
                }
            }
            is AddSongEvent.NewCategoryNameChanged -> {
                _uiState.update { it.copy(newCategoryName = event.name) }
            }
            is AddSongEvent.DifficultyChanged -> {
                _uiState.update { it.copy(difficulty = event.difficulty) }
            }
            is AddSongEvent.AlbumArtChanged -> {
                _uiState.update { it.copy(albumArt = event.url) }
            }
            is AddSongEvent.AlbumArtSelected -> {
                _uiState.update { it.copy(albumArt = event.url) }
            }
            is AddSongEvent.SongKeyChanged -> {
                _uiState.update { it.copy(songKey = event.key) }
            }
            is AddSongEvent.BpmChanged -> {
                // Only allow numeric input
                if (event.bpm.isEmpty() || event.bpm.all { it.isDigit() }) {
                    _uiState.update { it.copy(bpmString = event.bpm) }
                }
            }
            is AddSongEvent.KaraokeUrlChanged -> {
                _uiState.update { it.copy(karaokeUrl = event.url) }
            }
            is AddSongEvent.OriginalUrlChanged -> {
                _uiState.update { it.copy(originalUrl = event.url) }
            }
            is AddSongEvent.CoverUrlChanged -> {
                _uiState.update { it.copy(coverUrl = event.url) }
            }
            is AddSongEvent.LyricsLinkChanged -> {
                _uiState.update { it.copy(lyricsLink = event.url) }
            }
            is AddSongEvent.LyricsTextChanged -> {
                _uiState.update { it.copy(lyricsText = event.text) }
            }
            AddSongEvent.SearchAlbumArt -> searchAlbumArt()
        }
    }

    private fun searchAlbumArt() {
        val state = _uiState.value
        if (!state.canSearchAlbumArt || state.isSearchingAlbumArt) return

        viewModelScope.launch {
            _uiState.update { it.copy(isSearchingAlbumArt = true) }

            songRepository.searchAlbumArt(state.title.trim(), state.artistName.trim())
                .onSuccess { images ->
                    _uiState.update { it.copy(albumArtResults = images, isSearchingAlbumArt = false) }
                }
                .onFailure { exception ->
                    _uiState.update {
                        it.copy(
                            isSearchingAlbumArt = false,
                            error = exception.message ?: "앨범아트 검색에 실패했습니다",
                        )
                    }
                }
        }
    }

    fun createSong() {
        val state = _uiState.value
        if (!state.isValid || state.isSubmitting) return

        viewModelScope.launch {
            _uiState.update { it.copy(isSubmitting = true) }

            // Parse new categories from comma-separated string
            val newCategories = state.newCategoryName
                .split(",")
                .map { it.trim() }
                .filter { it.isNotEmpty() }

            val allCategoryNames = (state.selectedCategories + newCategories).toList()

            val request = CreateSongRequest(
                title = state.title.trim(),
                artistName = state.artistName.trim(),
                categoryNames = allCategoryNames.ifEmpty { null },
                difficulty = state.difficulty,
                albumArt = state.albumArt.trim().ifBlank { null },
                songKey = state.songKey.trim().ifBlank { null },
                bpm = state.bpmString.toIntOrNull(),
                karaokeUrl = state.karaokeUrl.trim().ifBlank { null },
                originalUrl = state.originalUrl.trim().ifBlank { null },
                coverUrl = state.coverUrl.trim().ifBlank { null },
                lyricsLink = state.lyricsLink.trim().ifBlank { null },
                lyricsText = state.lyricsText.trim().ifBlank { null },
            )

            songRepository.createSong(channelId, request)
                .onSuccess {
                    _uiState.update { it.copy(isSubmitting = false, isSuccess = true) }
                }
                .onFailure { exception ->
                    val errorMessage = when {
                        exception.message?.contains("403") == true -> "노래를 추가할 권한이 없습니다"
                        exception.message?.contains("409") == true ||
                            exception.message?.contains("중복") == true ||
                            exception.message?.contains("duplicate") == true -> "이미 등록된 노래입니다"
                        exception.message?.contains("401") == true -> "로그인이 필요합니다"
                        else -> exception.message ?: "노래 추가에 실패했습니다"
                    }
                    _uiState.update {
                        it.copy(isSubmitting = false, error = errorMessage)
                    }
                }
        }
    }

    fun clearError() {
        _uiState.update { it.copy(error = null) }
    }
}
