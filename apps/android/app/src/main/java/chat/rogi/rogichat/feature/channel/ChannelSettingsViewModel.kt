package chat.rogi.rogichat.feature.channel

import androidx.lifecycle.SavedStateHandle
import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import chat.rogi.rogichat.channelport.core.domain.repository.ChannelRepository
import chat.rogi.rogichat.channelport.core.model.channel.ChannelLink
import chat.rogi.rogichat.channelport.core.model.channel.UpdateChannelRequest
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch

data class ChannelSettingsUiState(
    val isLoading: Boolean = true,
    val isSaving: Boolean = false,
    val name: String = "",
    val profileImageUrl: String? = null,
    val additionalLinks: List<ChannelLink> = emptyList(),
    val themeColor: String = "#6366f1",
    val originalWebPath: String = "",
    val originalChannelDescription: String? = null,
    val error: String? = null,
    val saveSuccess: Boolean = false,
    val isUploadingImage: Boolean = false,
)

sealed interface ChannelSettingsEvent {
    data class NameChanged(val name: String) : ChannelSettingsEvent
    data class ThemeColorChanged(val color: String) : ChannelSettingsEvent
    data class ProfileImageSelected(val fileName: String, val contentType: String, val imageBytes: ByteArray) : ChannelSettingsEvent
    data object RemoveProfileImage : ChannelSettingsEvent
    data class AddLink(val name: String, val url: String) : ChannelSettingsEvent
    data class UpdateLink(val index: Int, val name: String, val url: String) : ChannelSettingsEvent
    data class RemoveLink(val index: Int) : ChannelSettingsEvent
    data object Save : ChannelSettingsEvent
    data object ErrorDismissed : ChannelSettingsEvent
    data object SaveSuccessConsumed : ChannelSettingsEvent
}

class ChannelSettingsViewModel constructor(
    savedStateHandle: SavedStateHandle,
    private val channelRepository: ChannelRepository,
) : ViewModel() {

    private val channelIdentifier: String = checkNotNull(savedStateHandle["channelIdentifier"])

    private val _uiState = MutableStateFlow(ChannelSettingsUiState())
    val uiState: StateFlow<ChannelSettingsUiState> = _uiState.asStateFlow()

    init {
        loadChannel()
    }

    fun onEvent(event: ChannelSettingsEvent) {
        when (event) {
            is ChannelSettingsEvent.NameChanged -> {
                _uiState.update { it.copy(name = event.name) }
            }
            is ChannelSettingsEvent.ThemeColorChanged -> {
                _uiState.update { it.copy(themeColor = event.color) }
            }
            is ChannelSettingsEvent.ProfileImageSelected -> {
                uploadImage(event.fileName, event.contentType, event.imageBytes)
            }
            is ChannelSettingsEvent.RemoveProfileImage -> {
                _uiState.update { it.copy(profileImageUrl = null) }
            }
            is ChannelSettingsEvent.AddLink -> {
                val current = _uiState.value.additionalLinks
                if (current.size < 5) {
                    _uiState.update {
                        it.copy(additionalLinks = current + ChannelLink(name = event.name, url = event.url))
                    }
                }
            }
            is ChannelSettingsEvent.UpdateLink -> {
                val current = _uiState.value.additionalLinks.toMutableList()
                if (event.index in current.indices) {
                    current[event.index] = ChannelLink(name = event.name, url = event.url)
                    _uiState.update { it.copy(additionalLinks = current) }
                }
            }
            is ChannelSettingsEvent.RemoveLink -> {
                val current = _uiState.value.additionalLinks.toMutableList()
                if (event.index in current.indices) {
                    current.removeAt(event.index)
                    _uiState.update { it.copy(additionalLinks = current) }
                }
            }
            ChannelSettingsEvent.Save -> saveSettings()
            ChannelSettingsEvent.ErrorDismissed -> {
                _uiState.update { it.copy(error = null) }
            }
            ChannelSettingsEvent.SaveSuccessConsumed -> {
                _uiState.update { it.copy(saveSuccess = false) }
            }
        }
    }

    private fun loadChannel() {
        viewModelScope.launch {
            _uiState.update { it.copy(isLoading = true) }
            channelRepository.getChannel(channelIdentifier)
                .onSuccess { channel ->
                    _uiState.update {
                        it.copy(
                            isLoading = false,
                            name = channel.name,
                            profileImageUrl = channel.profileImageUrl,
                            additionalLinks = channel.additionalLinks,
                            themeColor = channel.themeColor,
                            originalWebPath = channel.webPath,
                            originalChannelDescription = channel.channelDescription,
                        )
                    }
                }
                .onFailure { e ->
                    _uiState.update {
                        it.copy(isLoading = false, error = e.message ?: "채널 정보를 불러오는데 실패했습니다")
                    }
                }
        }
    }

    private fun uploadImage(fileName: String, contentType: String, imageBytes: ByteArray) {
        viewModelScope.launch {
            _uiState.update { it.copy(isUploadingImage = true) }
            channelRepository.uploadImage(fileName, contentType, imageBytes)
                .onSuccess { response ->
                    _uiState.update {
                        it.copy(isUploadingImage = false, profileImageUrl = response.imageUrl)
                    }
                }
                .onFailure { e ->
                    _uiState.update {
                        it.copy(isUploadingImage = false, error = e.message ?: "이미지 업로드에 실패했습니다")
                    }
                }
        }
    }

    private fun saveSettings() {
        val state = _uiState.value
        if (state.name.isBlank()) {
            _uiState.update { it.copy(error = "채널 이름을 입력해주세요") }
            return
        }

        viewModelScope.launch {
            _uiState.update { it.copy(isSaving = true) }

            val validLinks = state.additionalLinks.filter {
                it.name.isNotBlank() && it.url.isNotBlank()
            }

            val request = UpdateChannelRequest(
                name = state.name,
                webPath = state.originalWebPath,
                profileImageUrl = state.profileImageUrl,
                additionalLinks = validLinks,
                themeColor = state.themeColor,
                channelDescription = state.originalChannelDescription,
            )

            channelRepository.updateChannel(channelIdentifier, request)
                .onSuccess {
                    _uiState.update { it.copy(isSaving = false, saveSuccess = true) }
                }
                .onFailure { e ->
                    _uiState.update {
                        it.copy(isSaving = false, error = e.message ?: "저장에 실패했습니다")
                    }
                }
        }
    }
}
