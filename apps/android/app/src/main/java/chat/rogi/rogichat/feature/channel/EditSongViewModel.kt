package chat.rogi.rogichat.feature.channel

import androidx.lifecycle.SavedStateHandle
import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import chat.rogi.rogichat.channelport.core.domain.repository.SongRepository
import chat.rogi.rogichat.channelport.core.model.song.AlbumArtImage
import chat.rogi.rogichat.channelport.core.model.song.Artist
import chat.rogi.rogichat.channelport.core.model.song.Category
import chat.rogi.rogichat.channelport.core.model.song.Song
import chat.rogi.rogichat.channelport.core.model.song.UpdateSongRequest
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch

data class EditSongUiState(
    val isLoading: Boolean = true,
    val isSubmitting: Boolean = false,
    val isSuccess: Boolean = false,
    val isDeleteSuccess: Boolean = false,
    val showDeleteDialog: Boolean = false,
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
    // Original song for reference
    val originalSong: Song? = null,
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

sealed interface EditSongEvent {
    data class TitleChanged(val title: String) : EditSongEvent
    data class ArtistNameChanged(val name: String) : EditSongEvent
    data class ArtistSelected(val artist: Artist) : EditSongEvent
    data class CategoryToggled(val categoryName: String) : EditSongEvent
    data class NewCategoryNameChanged(val name: String) : EditSongEvent
    data class DifficultyChanged(val difficulty: Int) : EditSongEvent
    data class AlbumArtChanged(val url: String) : EditSongEvent
    data class AlbumArtSelected(val url: String) : EditSongEvent
    data class SongKeyChanged(val key: String) : EditSongEvent
    data class BpmChanged(val bpm: String) : EditSongEvent
    data class KaraokeUrlChanged(val url: String) : EditSongEvent
    data class OriginalUrlChanged(val url: String) : EditSongEvent
    data class CoverUrlChanged(val url: String) : EditSongEvent
    data class LyricsLinkChanged(val url: String) : EditSongEvent
    data class LyricsTextChanged(val text: String) : EditSongEvent
    data object SearchAlbumArt : EditSongEvent
}

class EditSongViewModel constructor(
    savedStateHandle: SavedStateHandle,
    private val songRepository: SongRepository,
) : ViewModel() {

    private val channelIdentifier: String = checkNotNull(savedStateHandle["channelIdentifier"])
    private val songId: Int = checkNotNull(savedStateHandle["songId"])

    private val _uiState = MutableStateFlow(EditSongUiState())
    val uiState: StateFlow<EditSongUiState> = _uiState.asStateFlow()

    init {
        loadData()
    }

    private fun loadData() {
        viewModelScope.launch {
            _uiState.update { it.copy(isLoading = true) }

            // Load song, categories, and artists
            val songResult = songRepository.getSong(channelIdentifier, songId)
            val categoriesResult = songRepository.getCategories(channelIdentifier)
            val artistsResult = songRepository.getArtists(channelIdentifier)

            songResult.onSuccess { song ->
                _uiState.update { state ->
                    state.copy(
                        isLoading = false,
                        originalSong = song,
                        title = song.title,
                        artistName = song.artist?.name ?: "",
                        selectedCategories = song.categories.map { it.name }.toSet(),
                        difficulty = song.difficulty ?: 3,
                        albumArt = song.albumArt ?: "",
                        songKey = song.songKey ?: "",
                        bpmString = song.bpm?.toString() ?: "",
                        karaokeUrl = song.karaokeUrl ?: "",
                        originalUrl = song.originalUrl ?: "",
                        coverUrl = song.coverUrl ?: "",
                        lyricsLink = song.lyricsLink ?: "",
                        lyricsText = song.lyricsText ?: "",
                        categories = categoriesResult.getOrDefault(emptyList()),
                        artists = artistsResult.getOrDefault(emptyList()),
                    )
                }
            }.onFailure { exception ->
                _uiState.update {
                    it.copy(
                        isLoading = false,
                        error = exception.message ?: "노래 정보를 불러오는데 실패했습니다",
                    )
                }
            }
        }
    }

    fun onEvent(event: EditSongEvent) {
        when (event) {
            is EditSongEvent.TitleChanged -> {
                _uiState.update { it.copy(title = event.title) }
            }
            is EditSongEvent.ArtistNameChanged -> {
                _uiState.update { it.copy(artistName = event.name) }
            }
            is EditSongEvent.ArtistSelected -> {
                _uiState.update { it.copy(artistName = event.artist.name) }
            }
            is EditSongEvent.CategoryToggled -> {
                _uiState.update { state ->
                    val newCategories = if (state.selectedCategories.contains(event.categoryName)) {
                        state.selectedCategories - event.categoryName
                    } else {
                        state.selectedCategories + event.categoryName
                    }
                    state.copy(selectedCategories = newCategories)
                }
            }
            is EditSongEvent.NewCategoryNameChanged -> {
                _uiState.update { it.copy(newCategoryName = event.name) }
            }
            is EditSongEvent.DifficultyChanged -> {
                _uiState.update { it.copy(difficulty = event.difficulty) }
            }
            is EditSongEvent.AlbumArtChanged -> {
                _uiState.update { it.copy(albumArt = event.url) }
            }
            is EditSongEvent.AlbumArtSelected -> {
                _uiState.update { it.copy(albumArt = event.url) }
            }
            is EditSongEvent.SongKeyChanged -> {
                _uiState.update { it.copy(songKey = event.key) }
            }
            is EditSongEvent.BpmChanged -> {
                if (event.bpm.isEmpty() || event.bpm.all { it.isDigit() }) {
                    _uiState.update { it.copy(bpmString = event.bpm) }
                }
            }
            is EditSongEvent.KaraokeUrlChanged -> {
                _uiState.update { it.copy(karaokeUrl = event.url) }
            }
            is EditSongEvent.OriginalUrlChanged -> {
                _uiState.update { it.copy(originalUrl = event.url) }
            }
            is EditSongEvent.CoverUrlChanged -> {
                _uiState.update { it.copy(coverUrl = event.url) }
            }
            is EditSongEvent.LyricsLinkChanged -> {
                _uiState.update { it.copy(lyricsLink = event.url) }
            }
            is EditSongEvent.LyricsTextChanged -> {
                _uiState.update { it.copy(lyricsText = event.text) }
            }
            EditSongEvent.SearchAlbumArt -> searchAlbumArt()
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

    fun updateSong() {
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

            val request = UpdateSongRequest(
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

            songRepository.updateSong(channelIdentifier, songId, request)
                .onSuccess {
                    _uiState.update { it.copy(isSubmitting = false, isSuccess = true) }
                }
                .onFailure { exception ->
                    val errorMessage = when {
                        exception.message?.contains("403") == true -> "노래를 수정할 권한이 없습니다"
                        exception.message?.contains("401") == true -> "로그인이 필요합니다"
                        exception.message?.contains("404") == true -> "노래를 찾을 수 없습니다"
                        else -> exception.message ?: "노래 수정에 실패했습니다"
                    }
                    _uiState.update {
                        it.copy(isSubmitting = false, error = errorMessage)
                    }
                }
        }
    }

    fun showDeleteDialog() {
        _uiState.update { it.copy(showDeleteDialog = true) }
    }

    fun dismissDeleteDialog() {
        _uiState.update { it.copy(showDeleteDialog = false) }
    }

    fun deleteSong() {
        if (_uiState.value.isSubmitting) return

        viewModelScope.launch {
            _uiState.update { it.copy(isSubmitting = true, showDeleteDialog = false) }

            songRepository.deleteSong(channelIdentifier, songId)
                .onSuccess {
                    _uiState.update { it.copy(isSubmitting = false, isDeleteSuccess = true) }
                }
                .onFailure { exception ->
                    val errorMessage = when {
                        exception.message?.contains("403") == true -> "노래를 삭제할 권한이 없습니다"
                        exception.message?.contains("401") == true -> "로그인이 필요합니다"
                        exception.message?.contains("404") == true -> "노래를 찾을 수 없습니다"
                        else -> exception.message ?: "노래 삭제에 실패했습니다"
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
