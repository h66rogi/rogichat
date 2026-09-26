package chat.rogi.rogichat.feature.settings

import chat.rogi.rogichat.core.common.request
import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Job
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch

data class Birthday(val month: Int, val day: Int) {
    init { require(isValid(month, day)) }
    companion object {
        fun isValid(month: Int, day: Int) = month in 1..12 && day in 1..intArrayOf(31,29,31,30,31,30,31,31,30,31,30,31)[month - 1]
    }
}
data class UserProfile(val id: String, val nickname: String, val birthday: Birthday?, val birthdayVisibleToStreamers: Boolean,
                       val avatarAssetId: String? = null, val soopDisplayId: String? = null, val providerAvatarUrl: String? = null) {
    init { require(id.isNotBlank()); require(ProfileEditor(nickname).error == null) }
}
sealed interface FieldChange<out T> {
    data object Unchanged : FieldChange<Nothing>
    data class Set<T>(val value: T?) : FieldChange<T>
}
data class ProfileChanges(val nickname: String?, val birthday: FieldChange<Birthday>, val birthdayVisibleToStreamers: Boolean?)
interface ProfileRepository {
    suspend fun load(accountId: String): Result<UserProfile>
    suspend fun save(accountId: String, changes: ProfileChanges): Result<UserProfile>
}
data class ProfileUiState(
    val isLoading: Boolean = true,
    val original: UserProfile? = null,
    val editor: ProfileEditor = ProfileEditor(""),
    val month: String = "",
    val day: String = "",
    val visibleToStreamers: Boolean = false,
    val isSaving: Boolean = false,
    val saved: Boolean = false,
    val error: String? = null,
) {
    val birthday: Birthday? get() = if (month.isBlank() && day.isBlank()) null
        else month.toIntOrNull()?.let { m -> day.toIntOrNull()?.let { d -> if (Birthday.isValid(m, d)) Birthday(m, d) else null } }
    val birthdayError: String? get() = if ((month.isBlank() && day.isBlank()) || birthday != null) null else "올바른 월과 일을 입력해 주세요."
    val changed: Boolean get() = original?.let { editor.normalized != it.nickname || birthday != it.birthday ||
        birthdayError != null || visibleToStreamers != it.birthdayVisibleToStreamers } ?: false
    val canSave: Boolean get() = original != null && !isLoading && !isSaving && changed && editor.error == null && birthdayError == null
    fun changes(): ProfileChanges {
        val baseline = requireNotNull(original)
        return ProfileChanges(editor.normalized.takeIf { it != baseline.nickname },
            if (birthday == baseline.birthday) FieldChange.Unchanged else FieldChange.Set(birthday),
            visibleToStreamers.takeIf { it != baseline.birthdayVisibleToStreamers })
    }
}

// ProfileSettingsViewModel's load/edit/save/error lifecycle adapted from the reference.
// Domain validation + explicit clear semantics come from Rogichat's verified profile contract.
class ProfileViewModel(private val repository: ProfileRepository, private val accountId: String,
                       private val injectedScope: CoroutineScope? = null, autoLoad: Boolean = true) : ViewModel() {
    private val scope get() = injectedScope ?: viewModelScope
    private val mutable = MutableStateFlow(ProfileUiState())
    val uiState = mutable.asStateFlow()
    private var revision = 0L
    private var job: Job? = null
    init { if (autoLoad) load() }
    fun loadIfNeeded(nickname: String, avatarAssetId: String?) {
        val current = mutable.value
        if (current.error != null) return
        if (current.original?.let { it.nickname == nickname && it.avatarAssetId == avatarAssetId } == true) return
        if (current.isLoading && job?.isActive == true) return
        load()
    }
    fun load() {
        if (mutable.value.isSaving) return
        job?.cancel()
        val ticket = ++revision
        mutable.update { it.copy(isLoading = true, error = null) }
        job = scope.launch {
            request { repository.load(accountId) }.onSuccess { profile ->
                if (ticket == revision) {
                    if (profile.id != accountId) mutable.value = ProfileUiState(isLoading = false, error = "프로필을 불러오지 못했어요.")
                    else mutable.value = loaded(profile)
                }
            }.onFailure {
                if (ticket == revision) mutable.update { it.copy(isLoading = false, error = "프로필을 불러오지 못했어요. 다시 시도해 주세요.") }
            }
        }
    }
    fun editNickname(value: String) = edit { it.copy(editor = it.editor.edit(value)) }
    fun editMonth(value: String) = edit { it.copy(month = value.filter(Char::isDigit).take(2)) }
    fun editDay(value: String) = edit { it.copy(day = value.filter(Char::isDigit).take(2)) }
    fun setVisible(value: Boolean) = edit { it.copy(visibleToStreamers = value) }
    fun clearBirthday() = edit { it.copy(month = "", day = "", visibleToStreamers = false) }
    private fun edit(transform: (ProfileUiState) -> ProfileUiState) {
        mutable.update { if (it.isLoading || it.isSaving || it.original == null) it else transform(it).copy(saved = false, error = null) }
    }
    fun save() {
        val snapshot = mutable.value
        if (!snapshot.canSave) return
        val ticket = ++revision
        mutable.update { it.copy(isSaving = true, error = null, saved = false) }
        job = scope.launch {
            try {
                request { repository.save(accountId, snapshot.changes()) }.onSuccess { profile ->
                if (ticket == revision) {
                    if (profile.id != accountId) mutable.update { it.copy(isSaving = false, error = "프로필을 저장하지 못했어요.") }
                    else mutable.value = loaded(profile).copy(saved = true)
                }
            }.onFailure {
                    if (ticket == revision) mutable.update { it.copy(isSaving = false, error = "프로필을 저장하지 못했어요. 입력한 내용은 유지돼요.") }
                }
            } finally {
                if (ticket == revision) mutable.update { it.copy(isSaving = false) }
            }
        }
    }
    fun avatarApplied(assetId: String?) { mutable.update { it.copy(original = it.original?.copy(avatarAssetId = assetId)) } }
    fun dismissError() { mutable.update { it.copy(error = null) } }
    private fun loaded(profile: UserProfile) = ProfileUiState(isLoading = false, original = profile,
        editor = ProfileEditor(profile.nickname), month = profile.birthday?.month?.toString().orEmpty(),
        day = profile.birthday?.day?.toString().orEmpty(), visibleToStreamers = profile.birthdayVisibleToStreamers)
    override fun onCleared() { revision++; job?.cancel() }
}
