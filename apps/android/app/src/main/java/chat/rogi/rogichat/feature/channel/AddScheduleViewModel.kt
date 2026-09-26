package chat.rogi.rogichat.feature.channel

import androidx.lifecycle.SavedStateHandle
import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import chat.rogi.rogichat.channelport.core.domain.repository.ScheduleRepository
import chat.rogi.rogichat.channelport.core.model.schedule.ScheduleType
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch
import java.time.LocalDate
import java.time.LocalDateTime
import java.time.LocalTime
import java.time.ZoneId

data class AddScheduleUiState(
    val title: String = "",
    val startDate: LocalDate = LocalDate.now(),
    val startTime: LocalTime = LocalTime.of(20, 0),
    val endDate: LocalDate? = null,
    val endTime: LocalTime? = null,
    val allDay: Boolean = false,
    val status: ScheduleType = ScheduleType.LIVE,
    val visibility: ScheduleVisibility = ScheduleVisibility.PUBLIC,
    val location: String = "",
    val externalUrl: String = "",
    val content: String = "",
    val isSubmitting: Boolean = false,
    val isSuccess: Boolean = false,
    val error: String? = null,
) {
    val isValid: Boolean
        get() = title.isNotBlank()
}

enum class ScheduleVisibility(val displayName: String, val apiValue: String) {
    PUBLIC("공개", "PUBLIC"),
    PRIVATE("비공개", "PRIVATE"),
}

sealed interface AddScheduleEvent {
    data class TitleChanged(val title: String) : AddScheduleEvent
    data class StartDateChanged(val date: LocalDate) : AddScheduleEvent
    data class StartTimeChanged(val time: LocalTime) : AddScheduleEvent
    data class EndDateChanged(val date: LocalDate?) : AddScheduleEvent
    data class EndTimeChanged(val time: LocalTime?) : AddScheduleEvent
    data class AllDayToggled(val allDay: Boolean) : AddScheduleEvent
    data class StatusChanged(val status: ScheduleType) : AddScheduleEvent
    data class VisibilityChanged(val visibility: ScheduleVisibility) : AddScheduleEvent
    data class LocationChanged(val location: String) : AddScheduleEvent
    data class ExternalUrlChanged(val url: String) : AddScheduleEvent
    data class ContentChanged(val content: String) : AddScheduleEvent
}

class AddScheduleViewModel constructor(
    savedStateHandle: SavedStateHandle,
    private val scheduleRepository: ScheduleRepository,
) : ViewModel() {

    private val channelId: Int = checkNotNull(savedStateHandle["channelId"])

    private val _uiState = MutableStateFlow(AddScheduleUiState())
    val uiState: StateFlow<AddScheduleUiState> = _uiState.asStateFlow()

    fun onEvent(event: AddScheduleEvent) {
        when (event) {
            is AddScheduleEvent.TitleChanged -> {
                _uiState.update { it.copy(title = event.title) }
            }
            is AddScheduleEvent.StartDateChanged -> {
                _uiState.update { it.copy(startDate = event.date) }
            }
            is AddScheduleEvent.StartTimeChanged -> {
                _uiState.update { it.copy(startTime = event.time) }
            }
            is AddScheduleEvent.EndDateChanged -> {
                _uiState.update { it.copy(endDate = event.date) }
            }
            is AddScheduleEvent.EndTimeChanged -> {
                _uiState.update { it.copy(endTime = event.time) }
            }
            is AddScheduleEvent.AllDayToggled -> {
                _uiState.update {
                    val shouldForceAllDay = it.status == ScheduleType.TBD
                    it.copy(allDay = if (shouldForceAllDay) true else event.allDay)
                }
            }
            is AddScheduleEvent.StatusChanged -> {
                _uiState.update {
                    val forceAllDay = event.status == ScheduleType.TBD
                    it.copy(
                        status = event.status,
                        allDay = if (forceAllDay) true else it.allDay,
                    )
                }
            }
            is AddScheduleEvent.VisibilityChanged -> {
                _uiState.update { it.copy(visibility = event.visibility) }
            }
            is AddScheduleEvent.LocationChanged -> {
                _uiState.update { it.copy(location = event.location) }
            }
            is AddScheduleEvent.ExternalUrlChanged -> {
                _uiState.update { it.copy(externalUrl = event.url) }
            }
            is AddScheduleEvent.ContentChanged -> {
                _uiState.update { it.copy(content = event.content) }
            }
        }
    }

    fun createSchedule() {
        val state = _uiState.value
        if (!state.isValid) return

        _uiState.update { it.copy(isSubmitting = true) }

        viewModelScope.launch {
            val startDateTime = if (state.allDay) {
                state.startDate.atStartOfDay()
            } else {
                LocalDateTime.of(state.startDate, state.startTime)
            }

            val endDateTime = if (state.endDate != null) {
                if (state.allDay) {
                    state.endDate.atTime(23, 59, 59)
                } else {
                    LocalDateTime.of(state.endDate, state.endTime ?: LocalTime.of(23, 59))
                }
            } else null

            // LocalDateTime을 시스템 타임존 기준으로 UTC로 변환하여 ISO 8601 형식으로 전송
            val startAtUtc = startDateTime
                .atZone(ZoneId.systemDefault())
                .toInstant()
                .toString()

            val endAtUtc = endDateTime
                ?.atZone(ZoneId.systemDefault())
                ?.toInstant()
                ?.toString()

            scheduleRepository.createSchedule(
                channelId = channelId,
                title = state.title,
                startAt = startAtUtc,
                endAt = endAtUtc,
                allDay = state.allDay,
                status = state.status.name,
                visibility = state.visibility.apiValue,
                location = state.location.takeIf { it.isNotBlank() },
                externalUrl = state.externalUrl.takeIf { it.isNotBlank() },
                content = state.content.takeIf { it.isNotBlank() },
            ).onSuccess {
                _uiState.update { it.copy(isSubmitting = false, isSuccess = true) }
            }.onFailure { exception ->
                _uiState.update {
                    it.copy(
                        isSubmitting = false,
                        error = exception.message ?: "일정 생성에 실패했습니다",
                    )
                }
            }
        }
    }

    fun clearError() {
        _uiState.update { it.copy(error = null) }
    }
}
