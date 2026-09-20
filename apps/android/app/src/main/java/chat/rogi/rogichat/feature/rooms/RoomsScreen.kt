package chat.rogi.rogichat.feature.rooms

import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import chat.rogi.rogichat.core.design.ScreenStatus
import chat.rogi.rogichat.core.common.request
import chat.rogi.rogichat.core.network.RoomMode
import chat.rogi.rogichat.core.rooms.*
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Job
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.launch
import com.adamglin.PhosphorIcons
import com.adamglin.phosphoricons.Regular
import com.adamglin.phosphoricons.regular.ChatCircle

interface RoomsRepository {
    suspend fun refreshRooms(scope: RoomsAccountScope): Result<RoomDirectory>
    suspend fun moreRooms(scope: RoomsAccountScope, continuation: DiscoveryContinuation): Result<RoomDirectory>
}
data class RoomsState(val loading: Boolean = true, val directory: RoomDirectory? = null,
                      val loadingMore: Boolean = false, val error: String? = null)

/** Repository load/StateFlow/error ownership follows the reused Meloming settings flow.
 * Room discovery and authoritative membership are new Rogichat domain rules, not Talk UX.
 */
class RoomsViewModel(private val repository: RoomsRepository, private val accountScope: RoomsAccountScope,
                     private val injectedScope: CoroutineScope? = null) : ViewModel() {
    private val mutable = MutableStateFlow(RoomsState())
    val state = mutable.asStateFlow()
    private var revision = 0L
    private var job: Job? = null
    init { reload() }
    fun reload() {
        job?.cancel()
        val ticket = ++revision
        mutable.value = RoomsState()
        job = (injectedScope ?: viewModelScope).launch {
            try {
                val result = request { repository.refreshRooms(accountScope) }
                if (ticket == revision) mutable.value = result.fold({ RoomsState(loading = false, directory = it) },
                    { RoomsState(loading = false, error = errorMessage(it)) })
            } finally { if (ticket == revision && mutable.value.loading) mutable.value = RoomsState(loading = false,
                error = "대화 목록을 확인하지 못했어요. 다시 시도해 주세요.") }
        }
    }
    fun more() {
        val current = mutable.value
        val continuation = current.directory?.continuation ?: return
        if (current.loading || current.loadingMore) return
        val ticket = ++revision
        mutable.value = current.copy(loadingMore = true, error = null)
        job = (injectedScope ?: viewModelScope).launch {
            try {
                val result = request { repository.moreRooms(accountScope, continuation) }
                if (ticket == revision) mutable.value = result.fold({ RoomsState(loading = false, directory = it) },
                    { current.copy(error = errorMessage(it)) })
            } finally {
                if (ticket == revision && mutable.value.loadingMore) mutable.value = current.copy(error = "추가 목록을 확인하지 못했어요. 다시 시도해 주세요.")
            }
        }
    }
    private fun errorMessage(failure: Throwable) = when (failure) {
        is RoomsStorageException -> "기기에 대화 목록을 저장하지 못했어요. 저장 공간을 확인하고 다시 시도해 주세요."
        else -> "대화 목록을 불러오지 못했어요. 연결을 확인하고 다시 시도해 주세요."
    }
    override fun onCleared() { revision++; job?.cancel(); mutable.value = RoomsState(loading = false) }
}

@Composable
fun RoomsScreen(model: RoomsViewModel) {
    val state by model.state.collectAsStateWithLifecycle()
    val directory = state.directory
    when {
        state.loading -> ScreenStatus("대화 목록을 불러오는 중", "잠시만 기다려 주세요.", loading = true)
        directory == null -> ScreenStatus("대화 목록을 확인하지 못했어요", state.error.orEmpty(), onRetry = model::reload)
        else -> LazyColumn(Modifier.fillMaxSize(), contentPadding = PaddingValues(bottom = 20.dp)) {
            item {
                Row(Modifier.fillMaxWidth().padding(horizontal = 20.dp), horizontalArrangement = Arrangement.End) {
                    TextButton(onClick = model::reload, enabled = !state.loadingMore) { Text("새로고침") }
                }
                Text("참여 중인 대화", Modifier.padding(horizontal = 20.dp, vertical = 12.dp), style = MaterialTheme.typography.titleMedium)
                if (directory.memberships.isEmpty()) Text("아직 참여 중인 대화가 없어요.", Modifier.padding(20.dp),
                    color = MaterialTheme.colorScheme.onSurfaceVariant)
            }
            items(directory.memberships, key = { "member-${it.roomId.value}" }) { room -> RoomRow(room.name, room.mode) }
            item {
                HorizontalDivider(Modifier.padding(vertical = 16.dp))
                Text("대화 둘러보기", Modifier.padding(horizontal = 20.dp, vertical = 12.dp), style = MaterialTheme.typography.titleMedium)
                if (directory.discovered.isEmpty()) Text("지금 표시할 다른 대화가 없어요.", Modifier.padding(20.dp),
                    color = MaterialTheme.colorScheme.onSurfaceVariant)
            }
            items(directory.discovered, key = { "discover-${it.roomId.value}" }) { room -> RoomRow(room.name, room.mode) }
            state.error?.let { error -> item { Text(error, Modifier.padding(20.dp), color = MaterialTheme.colorScheme.error) } }
            if (directory.continuation != null) item {
                TextButton(onClick = model::more, enabled = !state.loadingMore, modifier = Modifier.fillMaxWidth()) {
                    if (state.loadingMore) CircularProgressIndicator(Modifier.size(20.dp), strokeWidth = 2.dp)
                    else Text(if (state.error == null) "더 보기" else "다시 시도")
                }
            }
        }
    }
}

@Composable
private fun RoomRow(name: String, mode: RoomMode) {
    // A directory entry has no action until actual room navigation is implemented.
    ListItem(headlineContent = { Text(name) }, supportingContent = { Text(if (mode == RoomMode.FAN) "팬 대화" else "그룹 대화") },
        leadingContent = { Icon(PhosphorIcons.Regular.ChatCircle, null, Modifier.size(28.dp), MaterialTheme.colorScheme.primary) })
}
