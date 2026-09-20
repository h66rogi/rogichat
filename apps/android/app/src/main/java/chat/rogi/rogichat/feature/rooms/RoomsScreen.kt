package chat.rogi.rogichat.feature.rooms

import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.unit.dp
import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import chat.rogi.rogichat.core.design.ScreenStatus
import chat.rogi.rogichat.core.common.request
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Job
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.launch
import com.adamglin.PhosphorIcons
import com.adamglin.phosphoricons.Regular
import com.adamglin.phosphoricons.regular.ChatCircle

// New Rogichat domain/UI: the reference chat UX is explicitly excluded from reuse.
data class RoomSummary(val id: String, val title: String, val description: String?)
interface RoomsRepository { suspend fun list(accountId: String): Result<List<RoomSummary>> }
sealed interface RoomsState {
    data object Loading : RoomsState
    data object Failed : RoomsState
    data class Loaded(val rooms: List<RoomSummary>) : RoomsState
}
class RoomsViewModel(private val repository: RoomsRepository, private val accountId: String,
                     private val injectedScope: CoroutineScope? = null) : ViewModel() {
    private val mutable = MutableStateFlow<RoomsState>(RoomsState.Loading)
    val state = mutable.asStateFlow()
    private var revision = 0L
    private var job: Job? = null
    init { reload() }
    fun reload() {
        job?.cancel()
        val ticket = ++revision
        mutable.value = RoomsState.Loading
        job = (injectedScope ?: viewModelScope).launch {
            val result = request { repository.list(accountId) }
            if (ticket == revision) mutable.value = result.fold({ RoomsState.Loaded(it) }, { RoomsState.Failed })
        }
    }
    override fun onCleared() { revision++; job?.cancel() }
}
@Composable
fun RoomsScreen(model: RoomsViewModel, onOpen: (String) -> Unit) {
    val state by model.state.collectAsStateWithLifecycle()
    when (val value = state) {
        RoomsState.Loading -> ScreenStatus("대화를 불러오는 중", "잠시만 기다려 주세요.", loading = true)
        RoomsState.Failed -> ScreenStatus("대화를 불러오지 못했어요", "연결 상태를 확인하고 다시 시도해 주세요.", onRetry = model::reload)
        is RoomsState.Loaded -> if (value.rooms.isEmpty()) {
            Column(Modifier.fillMaxSize().padding(32.dp), horizontalAlignment = Alignment.CenterHorizontally,
                verticalArrangement = Arrangement.Center) {
                Icon(PhosphorIcons.Regular.ChatCircle, null, Modifier.size(48.dp), MaterialTheme.colorScheme.onSurfaceVariant)
                Spacer(Modifier.height(20.dp))
                Text("아직 참여한 대화가 없어요", style = MaterialTheme.typography.titleLarge)
                Spacer(Modifier.height(8.dp))
                Text("참여할 수 있는 대화가 생기면 여기에 표시돼요.", color = MaterialTheme.colorScheme.onSurfaceVariant)
            }
        } else LazyColumn(Modifier.fillMaxSize()) {
            items(value.rooms, key = { it.id }) { room ->
                Row(Modifier.fillMaxWidth().clickable(role = Role.Button, onClick = { onOpen(room.id) })
                    .padding(horizontal = 20.dp, vertical = 18.dp), verticalAlignment = Alignment.CenterVertically) {
                    Surface(color = MaterialTheme.colorScheme.primaryContainer, shape = MaterialTheme.shapes.medium) {
                        Icon(PhosphorIcons.Regular.ChatCircle, null, Modifier.padding(14.dp).size(28.dp), MaterialTheme.colorScheme.onPrimaryContainer)
                    }
                    Spacer(Modifier.width(16.dp))
                    Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(4.dp)) {
                        Text(room.title, style = MaterialTheme.typography.titleMedium)
                        room.description?.let { Text(it, style = MaterialTheme.typography.bodyMedium,
                            color = MaterialTheme.colorScheme.onSurfaceVariant) }
                    }
                }
            }
        }
    }
}
