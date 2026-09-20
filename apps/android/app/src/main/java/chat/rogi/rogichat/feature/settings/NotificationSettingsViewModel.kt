package chat.rogi.rogichat.feature.settings

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import chat.rogi.rogichat.core.common.request
import chat.rogi.rogichat.core.network.*
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Job
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch

/** Meloming preferences repository boundary, with an explicit disable command and required CAS. */
data class NotificationAccountScope(val accountId: String, val localEpoch: Long)
interface NotificationPreferencesRepository {
    suspend fun getPreferences(scope: NotificationAccountScope): Result<NotificationPreferences>
    suspend fun disablePush(scope: NotificationAccountScope, expected: PreferenceGeneration): Result<NotificationPreferences>
}
data class NotificationSettingsUiState(
    val isLoading: Boolean = true,
    val preferences: NotificationPreferences? = null,
    val isSaving: Boolean = false,
    val needsRefresh: Boolean = false,
    val error: String? = null,
) {
    val canDisable get() = preferences?.pushEnabled == true && !isLoading && !isSaving && !needsRefresh
}

/** Reuses Meloming NotificationSettingsViewModel's load/StateFlow/repository/error lifecycle.
 * New M11 CAS requires confirmed state and request fences instead of optimistic rollback.
 */
class NotificationSettingsViewModel(private val repository: NotificationPreferencesRepository, private val accountScope: NotificationAccountScope,
                                    private val injectedScope: CoroutineScope? = null) : ViewModel() {
    private val scope get() = injectedScope ?: viewModelScope
    private val mutable = MutableStateFlow(NotificationSettingsUiState())
    val uiState = mutable.asStateFlow()
    private var requestRevision = 0L
    private var mutationRevision = 0L
    private var readJob: Job? = null
    private var saveJob: Job? = null
    init { loadPreferences() }

    fun loadPreferences() = load(notice = null)
    private fun load(notice: String?) {
        if (mutable.value.isSaving) return
        readJob?.cancel()
        val readTicket = ++requestRevision
        val mutation = mutationRevision
        mutable.update { it.copy(isLoading = true, error = notice) }
        readJob = scope.launch {
            try {
                request { repository.getPreferences(accountScope) }.onSuccess { value ->
                    if (readTicket == requestRevision && mutation == mutationRevision) mutable.value =
                        NotificationSettingsUiState(isLoading = false, preferences = value, error = notice)
                }.onFailure { failure ->
                    if (readTicket == requestRevision && mutation == mutationRevision) mutable.update {
                        it.copy(isLoading = false, needsRefresh = true, error = errorMessage(failure, saving = false))
                    }
                }
            } finally {
                if (readTicket == requestRevision && mutation == mutationRevision) mutable.update { it.copy(isLoading = false) }
            }
        }
    }

    fun disablePush() {
        val state = mutable.value
        if (!state.canDisable) return
        val expected = requireNotNull(state.preferences).generation
        val mutation = ++mutationRevision // Fence older GETs before sending the PUT.
        ++requestRevision
        readJob?.cancel()
        mutable.update { it.copy(isSaving = true, error = null) }
        saveJob = scope.launch {
            try {
                val result = request { repository.disablePush(accountScope, expected) }
                if (mutation != mutationRevision) return@launch
                val updated = result.getOrNull()
                if (updated != null && !updated.pushEnabled) {
                    mutable.value = NotificationSettingsUiState(isLoading = false, preferences = updated)
                } else {
                    val failure = result.exceptionOrNull() ?: InvalidResponse()
                    val notice = errorMessage(failure, saving = true)
                    mutable.update { it.copy(isSaving = false, needsRefresh = true, error = notice) }
                    // A read reconciles uncertain writes/conflicts. It never replays a desired value.
                    load(notice)
                }
            } catch (cancelled: CancellationException) {
                if (mutation == mutationRevision) mutable.update {
                    it.copy(needsRefresh = true, error = "변경 결과를 확인하지 못했어요. 최신 설정을 다시 확인해 주세요.")
                }
                throw cancelled
            } finally {
                if (mutation == mutationRevision) mutable.update { it.copy(isSaving = false) }
            }
        }
    }

    private fun errorMessage(failure: Throwable, saving: Boolean): String = when {
        failure is ApiException && failure.statusCode == 409 && failure.code == "CONFLICT" ->
            "설정을 저장하지 못했어요. 최신 설정을 확인한 뒤 다시 선택해 주세요."
        failure is ApiException && failure.statusCode == 503 && failure.code == "AUTH_UNAVAILABLE" ->
            if (saving) "지금은 계정 알림 설정을 변경할 수 없어요." else "지금은 계정 알림 설정을 불러올 수 없어요."
        saving -> "변경 결과를 확인하지 못했어요. 최신 설정을 다시 확인해 주세요."
        else -> "계정 알림 설정을 불러오지 못했어요. 연결을 확인하고 다시 시도해 주세요."
    }
    override fun onCleared() {
        ++requestRevision; ++mutationRevision
        readJob?.cancel(); saveJob?.cancel()
        mutable.value = NotificationSettingsUiState(isLoading = false)
    }
}
