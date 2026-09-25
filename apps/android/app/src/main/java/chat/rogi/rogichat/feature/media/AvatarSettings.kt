package chat.rogi.rogichat.feature.media

import androidx.compose.foundation.layout.*
import androidx.compose.foundation.clickable
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import chat.rogi.rogichat.core.media.*
import chat.rogi.rogichat.core.session.SessionIdentity
import kotlinx.coroutines.*
import kotlinx.coroutines.flow.*

/** Read-only profile hero reuses the actual account permission and media lease. */
@Composable
fun AccountProfileAvatar(repository: AccountMediaRepository, expected: SessionIdentity, assetID: String?) {
    key(expected, assetID) {
        var session by remember { mutableStateOf<AccountMediaSession?>(null) }
        var failed by remember { mutableStateOf(false) }
        var retry by remember { mutableIntStateOf(0) }
        LaunchedEffect(retry) {
            failed = false; session = null
            try { session = repository.open(expected) }
            catch (cancelled: CancellationException) { throw cancelled }
            catch (_: Exception) { failed = true }
        }
        val current = session
        if (current != null) {
            if (assetID != null) AuthorizedMedia(current.client, assetID, MediaAccess.Preview(MediaVariant.image), Modifier.fillMaxSize(), avatar = true)
            else AuthorizedProviderAvatar(current.client, modifier = Modifier.fillMaxSize())
        }
        else AvatarPlaceholder(Modifier.fillMaxSize().clickable(enabled = failed) { retry++ })
    }
}

data class AvatarSettingsState(val session: AccountMediaSession? = null, val pending: List<PendingMedia> = emptyList(),
    val ready: MediaReceipt? = null, val busy: Boolean = true, val error: String? = null, val applied: Boolean = false, val avatar: String? = null, val providerAvatarAvailable: Boolean = false)
class AvatarSettingsModel(private val repository: AccountMediaRepository, private val expected: SessionIdentity, initialAvatar: String?, providerAvatarAvailable: Boolean = false) : ViewModel() {
    private val mutable = MutableStateFlow(AvatarSettingsState(avatar = initialAvatar, providerAvatarAvailable = providerAvatarAvailable))
    val state = mutable.asStateFlow()
    private var generation = 0L
    init { load() }
    fun load() { if (state.value.session != null && state.value.busy) return
        val ticket = ++generation
        mutable.value = mutable.value.copy(busy = true, error = null)
        viewModelScope.launch { try {
            val session = repository.open(expected); val pending = repository.pending(session)
            if (ticket == generation) mutable.value = state.value.copy(session = session, pending = pending, busy = false)
        } catch (cancelled: CancellationException) { throw cancelled }
        catch (_: Exception) { if (ticket == generation) mutable.value = state.value.copy(busy = false, error = "프로필 사진 설정을 확인하지 못했어요.") } }
    }
    suspend fun selected(file: MediaFile) = operation { session ->
        val receipt = MediaUpload(session.client, session.journal).start(file)
        mutable.value = state.value.copy(ready = receipt)
    }
    fun recover(pending: PendingMedia) { viewModelScope.launch { operation { session ->
        require(pending in state.value.pending)
        val receipt = MediaUpload(session.client, session.journal).recover(pending)
        mutable.value = state.value.copy(ready = receipt)
    } } }
    fun apply(ready: MediaReceipt?) { viewModelScope.launch { operation { session ->
        require(ready == null || ready == state.value.ready)
        try {
            session.client.updateAvatar(ready)
            if (ready != null) session.journal.remove(session.client.scope, ready.assetId)
            mutable.value = state.value.copy(ready = null, avatar = ready?.assetId, providerAvatarAvailable = false, applied = true)
        } catch (cancelled: CancellationException) { throw cancelled }
        catch (failure: Exception) {
            // GET only confirms current state; it cannot prove the preceding PATCH was acknowledged.
            try { val current = repository.profile(session); mutable.value = state.value.copy(avatar = current.avatarAssetId, providerAvatarAvailable = current.providerAvatarUrl != null) }
            catch (cancelled: CancellationException) { throw cancelled } catch (_: Exception) { }
            throw failure
        }
    } } }
    fun dismissApplied() { mutable.value = state.value.copy(applied = false) }
    fun failure() { mutable.value = state.value.copy(error = "사진을 처리하지 못했어요. 파일 형식과 연결 상태를 확인해 주세요.") }
    private suspend fun operation(block: suspend (AccountMediaSession) -> Unit) {
        val session = state.value.session ?: return
        if (state.value.busy) return
        val ticket = generation
        mutable.value = state.value.copy(busy = true, error = null, applied = false)
        try { session.client.scope.check(); block(session) }
        catch (cancelled: CancellationException) { throw cancelled }
        catch (_: Exception) { if (ticket == generation) mutable.value = state.value.copy(error = "사진을 적용하지 못했어요. 다시 시도해 주세요.") }
        finally {
            if (ticket == generation) {
                try { mutable.value = state.value.copy(pending = repository.pending(session)) }
                catch (cancelled: CancellationException) { throw cancelled }
                catch (_: Exception) { mutable.value = state.value.copy(error = "기기에 저장된 사진 처리 상태를 확인하지 못했어요.") }
                finally { mutable.value = state.value.copy(busy = false) }
            }
        }
    }
    override fun onCleared() { generation++ }
}
@Composable
fun AvatarSettings(model: AvatarSettingsModel, profileBusy: Boolean, onApplied: (String?) -> Unit) {
    val state by model.state.collectAsStateWithLifecycle()
    var clear by remember { mutableStateOf(false) }
    LaunchedEffect(state.applied) { if (state.applied) { onApplied(state.avatar); model.dismissApplied() } }
    Column(Modifier.fillMaxWidth().padding(20.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
        Text("프로필 사진", style = MaterialTheme.typography.titleMedium)
        state.error?.let { Text(it, color = MaterialTheme.colorScheme.error) }
        if (state.busy) LinearProgressIndicator(Modifier.fillMaxWidth())
        val session = state.session
        if (session == null) { if (!state.busy) TextButton(onClick = model::load) { Text("다시 확인") } }
        else {
            state.ready?.let { ready ->
                AuthorizedMedia(session.client, ready.assetId, MediaAccess.Preview(MediaVariant.image), Modifier.size(96.dp))
                TextButton(enabled = !state.busy && !profileBusy, onClick = { model.apply(ready) }) { Text("이 사진을 프로필에 적용") }
            }
            if (state.ready == null) {
                if (state.avatar != null) AuthorizedMedia(session.client, requireNotNull(state.avatar), MediaAccess.Preview(MediaVariant.image), Modifier.size(96.dp), avatar = true)
                else if (state.providerAvatarAvailable) AuthorizedProviderAvatar(session.client, modifier = Modifier.size(96.dp))
            }
            MediaPicker(MediaKind.AVATAR, !state.busy && !profileBusy, session.client.scope, model::selected, { model.failure() })
            state.pending.filter { it.assetId != state.ready?.assetId }.forEach { pending ->
                TextButton(enabled = !state.busy && !profileBusy, onClick = { model.recover(pending) }) { Text("이전 사진 계속 사용하기") }
            }
            if (state.avatar != null || state.providerAvatarAvailable) TextButton(enabled = !state.busy && !profileBusy, onClick = { clear = true }) { Text("프로필 사진 지우기") }
        }
    }
    if (clear) AlertDialog(onDismissRequest = { clear = false }, title = { Text("프로필 사진을 지울까요?") },
        text = { Text("프로필에 표시되는 사진을 제거해요.") }, confirmButton = { TextButton(onClick = { clear = false; model.apply(null) }) { Text("지우기") } },
        dismissButton = { TextButton(onClick = { clear = false }) { Text("취소") } })
}
