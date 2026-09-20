package chat.rogi.rogichat.feature.rooms

import androidx.compose.foundation.layout.*
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import chat.rogi.rogichat.core.design.ScreenStatus
import chat.rogi.rogichat.core.common.request
import chat.rogi.rogichat.core.network.RoomMode
import chat.rogi.rogichat.core.network.RoomId
import chat.rogi.rogichat.core.network.Membership
import chat.rogi.rogichat.core.rooms.*
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Job
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.collect
import kotlinx.coroutines.flow.drop
import kotlinx.coroutines.launch
import com.adamglin.PhosphorIcons
import com.adamglin.phosphoricons.Regular
import com.adamglin.phosphoricons.regular.ChatCircle

interface RoomsRepository {
    val roomRefreshRequests: StateFlow<Long>? get() = null
    val roomCommands: StateFlow<RoomCommandState>
    suspend fun submitRoomCommand(intent: RoomCommandIntent): Result<Unit>
    suspend fun recheckRoomCommand(scope: RoomsAccountScope): Result<Unit>
    suspend fun refreshRooms(scope: RoomsAccountScope): Result<RoomDirectory>
    suspend fun moreRooms(scope: RoomsAccountScope, continuation: DiscoveryContinuation): Result<RoomDirectory>
}
data class RoomsState(val loading: Boolean = true, val directory: RoomDirectory? = null,
                      val loadingMore: Boolean = false, val error: String? = null, val command: RoomCommandState? = null, val notice: String? = null)

/** Repository load/StateFlow/error ownership follows the reused Meloming settings flow.
 * Room discovery and authoritative membership are new Rogichat domain rules, not Talk UX.
 */
class RoomsViewModel(private val repository: RoomsRepository, private val accountScope: RoomsAccountScope,
                     private val injectedScope: CoroutineScope? = null) : ViewModel() {
    private val mutable = MutableStateFlow(RoomsState(notice = unresolvedNotice()))
    val state = mutable.asStateFlow()
    private var revision = 0L
    private var job: Job? = null
    private val externalRefresh: Job?
    private val observer: Job
    init {
        externalRefresh = repository.roomRefreshRequests?.let { flow -> (injectedScope ?: viewModelScope).launch { flow.drop(1).collect { reload() } } }
        val initial = repository.roomCommands.value
        if (initial.scope == accountScope && (initial.busy || initial.needsVerification)) applyCommand(initial) else reload()
        observer = (injectedScope ?: viewModelScope).launch {
            var first = true
            repository.roomCommands.collect { command ->
                val ignoreInitialTerminal = first && command == initial && !initial.busy && !initial.needsVerification
                first = false
                if (!ignoreInitialTerminal && command.scope == accountScope) applyCommand(command)
                else if (command.scope == null && mutable.value.command != null) {
                    revision++; job?.cancel(); mutable.value = RoomsState()
                }
            }
        }
    }
    private fun applyCommand(command: RoomCommandState) {
        revision++; job?.cancel()
        mutable.value = RoomsState(loading = false, directory = command.directory, error = command.verificationIssue?.message ?: command.issue?.takeUnless { it == RoomCommandIssue.UNKNOWN }?.message, command = command,
            notice = command.issue?.takeIf { it == RoomCommandIssue.UNKNOWN }?.message)
    }
    private fun commandBlocks() = repository.roomCommands.value.let {
        it.scope == accountScope && (it.busy || it.needsVerification)
    }
    fun join(room: RoomId, renderedCycle: RoomId) {
        submit(RoomCommandIntent(accountScope, room, RoomAction.JOIN, renderedCycle))
    }
    fun leaveIntent(room: Membership, renderedCycle: RoomId) =
        RoomCommandIntent(accountScope, room.roomId, RoomAction.LEAVE, renderedCycle, room.membershipScope)
    fun submit(intent: RoomCommandIntent) {
        if (commandBlocks() || mutable.value.command?.busy == true) return
        val before = mutable.value
        val ticket = ++revision; job?.cancel()
        mutable.value = RoomsState(loading = false, command = RoomCommandState(accountScope, RoomCommandPhase.SENDING, intent.action))
        job = (injectedScope ?: viewModelScope).launch {
            val result = request { repository.submitRoomCommand(intent) }
            if (ticket == revision) result.exceptionOrNull()?.let {
                mutable.value = before.copy(error = if (it is StaleRoomSelection) "참여 상태가 바뀌었어요. 목록을 새로고침해 주세요." else errorMessage(it), command = null)
            }
        }
    }
    fun recheck() {
        if (!repository.roomCommands.value.needsVerification) return
        job = (injectedScope ?: viewModelScope).launch { request { repository.recheckRoomCommand(accountScope) } }
    }
    private fun unresolvedNotice() = repository.roomCommands.value.takeIf {
        it.scope == accountScope && it.issue == RoomCommandIssue.UNKNOWN
    }?.issue?.message
    fun reload() {
        if (commandBlocks()) return
        job?.cancel()
        val ticket = ++revision
        mutable.value = RoomsState(notice = unresolvedNotice())
        job = (injectedScope ?: viewModelScope).launch {
            try {
                val result = request { repository.refreshRooms(accountScope) }
                if (ticket == revision) mutable.value = result.fold({ RoomsState(loading = false, directory = it, notice = unresolvedNotice()) },
                    { RoomsState(loading = false, error = errorMessage(it), notice = unresolvedNotice()) })
            } finally { if (ticket == revision && mutable.value.loading) mutable.value = RoomsState(loading = false,
                error = "대화 목록을 확인하지 못했어요. 다시 시도해 주세요.", notice = unresolvedNotice()) }
        }
    }
    fun more() {
        val current = mutable.value
        val continuation = current.directory?.continuation ?: return
        if (current.loading || current.loadingMore || commandBlocks()) return
        val ticket = ++revision
        mutable.value = current.copy(loadingMore = true, error = null, notice = unresolvedNotice())
        job = (injectedScope ?: viewModelScope).launch {
            try {
                val result = request { repository.moreRooms(accountScope, continuation) }
                if (ticket == revision) mutable.value = result.fold({ RoomsState(loading = false, directory = it, notice = unresolvedNotice()) },
                    { current.copy(error = errorMessage(it), notice = unresolvedNotice()) })
            } finally {
                if (ticket == revision && mutable.value.loadingMore) mutable.value = current.copy(error = "추가 목록을 확인하지 못했어요. 다시 시도해 주세요.", notice = unresolvedNotice())
            }
        }
    }
    private fun errorMessage(failure: Throwable) = when (failure) {
        is RoomsStorageException -> "기기에 대화 목록을 저장하지 못했어요. 저장 공간을 확인하고 다시 시도해 주세요."
        else -> "대화 목록을 불러오지 못했어요. 연결을 확인하고 다시 시도해 주세요."
    }
    override fun onCleared() { revision++; job?.cancel(); observer.cancel(); externalRefresh?.cancel(); mutable.value = RoomsState(loading = false) }
}

@Composable
fun RoomsScreen(model: RoomsViewModel, onOpen: ((Membership, RoomId) -> Unit)? = null) {
    val state by model.state.collectAsStateWithLifecycle()
    val directory = state.directory
    val command = state.command
    var leaveTarget by remember { mutableStateOf<Pair<Membership, RoomCommandIntent>?>(null) }
    LaunchedEffect(directory?.cycle, command?.phase, leaveTarget?.second?.cycle) {
        if (leaveTarget?.second?.cycle != directory?.cycle) leaveTarget = null
    }
    // Adapted Meloming MoreScreen/MyReviewsScreen's selected-target destructive AlertDialog.
    leaveTarget?.takeIf { it.second.cycle == directory?.cycle }?.let { (room, intent) ->
        AlertDialog(
            onDismissRequest = { leaveTarget = null },
            title = { Text("대화에서 나가기") },
            text = { Column(Modifier.verticalScroll(rememberScrollState())) {
                Text("${room.name}에서 나가시겠어요?\n나가도 보낸 메시지는 삭제되지 않아요.")
            } },
            confirmButton = {
                TextButton(onClick = { leaveTarget = null; model.submit(intent) }) {
                    Text("나가기", color = MaterialTheme.colorScheme.error)
                }
            },
            dismissButton = { TextButton(onClick = { leaveTarget = null }) { Text("취소") } },
        )
    }
    Column(Modifier.fillMaxSize()) {
        state.notice?.let { notice ->
            Text(notice, Modifier.fillMaxWidth().padding(horizontal = 20.dp, vertical = 12.dp),
                style = MaterialTheme.typography.bodyMedium, color = MaterialTheme.colorScheme.onSurfaceVariant)
        }
        when {
            command?.busy == true -> ScreenStatus(
                if (command.phase == RoomCommandPhase.SENDING) "요청을 처리하는 중" else "참여 상태를 확인하는 중",
                "잠시만 기다려 주세요.", loading = true)
            command?.needsVerification == true -> ScreenStatus("참여 상태를 확인하지 못했어요",
                state.error ?: "연결을 확인하고 참여 상태를 다시 확인해 주세요.", onRetry = model::recheck, retryLabel = "참여 상태 다시 확인")
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
                items(directory.memberships, key = { "member-${it.roomId.value}" }) { room ->
                    RoomRow(room.name, room.mode, "나가기", enabled = !state.loadingMore,
                        onOpen = onOpen?.let { open -> { open(room, directory.cycle) } }) {
                        leaveTarget = room to model.leaveIntent(room, directory.cycle)
                    }
                }
                item {
                    HorizontalDivider(Modifier.padding(vertical = 16.dp))
                    Text("대화 둘러보기", Modifier.padding(horizontal = 20.dp, vertical = 12.dp), style = MaterialTheme.typography.titleMedium)
                    if (directory.discovered.isEmpty()) Text("지금 표시할 다른 대화가 없어요.", Modifier.padding(20.dp),
                        color = MaterialTheme.colorScheme.onSurfaceVariant)
                }
                items(directory.discovered, key = { "discover-${it.roomId.value}" }) { room ->
                    RoomRow(room.name, room.mode, "참여", enabled = !state.loadingMore) { model.join(room.roomId, directory.cycle) }
                }
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
}

@Composable
private fun RoomRow(name: String, mode: RoomMode, action: String, enabled: Boolean, onOpen: (() -> Unit)? = null, onAction: () -> Unit) {
    // Keep long names and large-font actions on separate rows.
    Column {
        ListItem(headlineContent = { Text(name) }, supportingContent = { Text(if (mode == RoomMode.FAN) "팬 대화" else "그룹 대화") },
            leadingContent = { Icon(PhosphorIcons.Regular.ChatCircle, null, Modifier.size(28.dp), MaterialTheme.colorScheme.primary) })
        Row(Modifier.fillMaxWidth().padding(horizontal = 20.dp), horizontalArrangement = Arrangement.End) {
            if (onOpen != null) TextButton(onClick = onOpen, enabled = enabled, modifier = Modifier.semantics { contentDescription = "$name 열기" }) { Text("열기") }
            TextButton(onClick = onAction, enabled = enabled, modifier = Modifier.semantics { contentDescription = "$name $action" }) { Text(action) }
        }
    }
}
