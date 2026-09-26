package chat.rogi.rogichat.feature.rooms

import androidx.compose.foundation.layout.*
import androidx.compose.foundation.clickable
import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Modifier
import androidx.compose.ui.Alignment
import androidx.compose.ui.draw.clip
import androidx.compose.ui.unit.dp
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import chat.rogi.rogichat.core.design.ScreenStatus
import chat.rogi.rogichat.core.design.AppTabHeader
import chat.rogi.rogichat.core.common.request
import chat.rogi.rogichat.core.network.RoomAvailability
import chat.rogi.rogichat.core.network.RoomMode
import chat.rogi.rogichat.core.network.RoomId
import chat.rogi.rogichat.core.network.Membership
import chat.rogi.rogichat.core.conversation.ConversationSelection
import chat.rogi.rogichat.core.rooms.*
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Job
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.collect
import kotlinx.coroutines.flow.drop
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.launch
import com.adamglin.PhosphorIcons
import com.adamglin.phosphoricons.Regular
import com.adamglin.phosphoricons.regular.ChatCircle
import com.adamglin.phosphoricons.regular.GearSix
import com.adamglin.phosphoricons.regular.MagnifyingGlass

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
            notice = command.issue?.takeIf { it == RoomCommandIssue.UNKNOWN && it.message.isNotEmpty() }?.message)
    }
    private fun commandBlocks() = repository.roomCommands.value.let {
        it.scope == accountScope && (it.busy || it.needsVerification)
    }
    fun join(room: RoomId, renderedCycle: RoomId) {
        val directory = mutable.value.directory ?: return
        if (directory.cycle != renderedCycle || directory.discovered.find { it.roomId == room }?.availability == RoomAvailability.OWNER_PENDING) return
        submit(RoomCommandIntent(accountScope, room, RoomAction.JOIN, renderedCycle))
    }
    fun leaveIntent(room: Membership, renderedCycle: RoomId) =
        RoomCommandIntent(accountScope, room.roomId, RoomAction.LEAVE, renderedCycle, room.membershipScope)
    suspend fun leaveConversation(selected: ConversationSelection): String? {
        val current = mutable.value.directory ?: return "대화 참여 상태를 다시 확인해 주세요."
        val room = current.memberships.firstOrNull { it.roomId == selected.membership.roomId }
        if (selected.account != accountScope || room != selected.membership ||
            mutable.value.loading || commandBlocks()) return "대화 참여 상태를 다시 확인해 주세요."
        submit(leaveIntent(room, current.cycle))
        val result = state.first { it.command?.busy != true }
        if (result.error != null) return result.error
        if (result.directory?.memberships?.none { it.roomId == room.roomId } == true) return null
        return "대화에서 나가지 못했어요. 다시 시도해 주세요."
    }
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
    }?.issue?.message?.takeIf { it.isNotEmpty() }
    private fun unresolvedMembership() = repository.roomCommands.value.let {
        it.scope == accountScope && it.issue == RoomCommandIssue.UNKNOWN
    }
    fun reload() {
        if (commandBlocks()) return
        job?.cancel()
        val ticket = ++revision
        // An unresolved join/leave may have invalidated the old membership. Do not
        // keep its rows visible while authoritative reconciliation is retried.
        val previous = mutable.value.directory.takeUnless { unresolvedMembership() }
        mutable.value = RoomsState(loading = true, directory = previous, notice = unresolvedNotice())
        job = (injectedScope ?: viewModelScope).launch {
            try {
                val result = request { repository.refreshRooms(accountScope) }
                if (ticket == revision) mutable.value = result.fold({ RoomsState(loading = false, directory = it, notice = unresolvedNotice()) },
                    { RoomsState(loading = false, directory = previous, error = errorMessage(it), notice = unresolvedNotice()) })
            } finally { if (ticket == revision && mutable.value.loading) mutable.value = RoomsState(loading = false,
                directory = previous, error = "대화 목록을 확인하지 못했어요. 다시 시도해 주세요.", notice = unresolvedNotice()) }
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

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun RoomsScreen(model: RoomsViewModel, onOpenSettings: () -> Unit,
                onOpen: ((Membership, RoomId) -> Unit)? = null) {
    val state by model.state.collectAsStateWithLifecycle()
    val directory = state.directory
    val command = state.command
    var query by remember { mutableStateOf("") }
    var discoveryQuery by remember { mutableStateOf("") }
    var showingDiscovery by remember { mutableStateOf(false) }
    var showingSearch by remember { mutableStateOf(false) }
    var selectedMode by remember { mutableStateOf<RoomMode?>(null) }
    if (showingDiscovery && directory != null) {
        val joinedIds = directory.memberships.map { it.roomId }.toSet()
        val discoverable = directory.discovered.filter {
            it.roomId !in joinedIds && it.name.contains(discoveryQuery, ignoreCase = true)
        }
        ModalBottomSheet(onDismissRequest = { showingDiscovery = false }) {
            Column(Modifier.fillMaxWidth().padding(horizontal = 20.dp)) {
                Text("대화 찾기", style = MaterialTheme.typography.titleLarge)
                Spacer(Modifier.height(16.dp))
                OutlinedTextField(discoveryQuery, { discoveryQuery = it }, Modifier.fillMaxWidth(),
                    singleLine = true, placeholder = { Text("대화방 검색") })
                Spacer(Modifier.height(12.dp))
                LazyColumn(contentPadding = PaddingValues(bottom = 32.dp)) {
                    if (discoverable.isEmpty()) item {
                        Text(if (discoveryQuery.isEmpty()) "지금 표시할 다른 대화가 없어요." else "검색 결과가 없어요.",
                            Modifier.fillMaxWidth().padding(vertical = 24.dp),
                            color = MaterialTheme.colorScheme.onSurfaceVariant)
                    }
                    items(discoverable, key = { it.roomId.value }) { room ->
                        ListItem(
                            headlineContent = { Text(room.name) },
                            supportingContent = { Text(if (room.mode == RoomMode.FAN) "팬 대화" else "그룹 대화") },
                            leadingContent = { RoomAvatar() },
                            trailingContent = {
                                if (room.availability == RoomAvailability.OWNER_PENDING)
                                    Text("방장 확인 대기 중", style = MaterialTheme.typography.labelSmall)
                                else Button(onClick = {
                                    showingDiscovery = false
                                    model.join(room.roomId, directory.cycle)
                                },
                                    enabled = !state.loading && !state.loadingMore) { Text("참여") }
                            },
                        )
                    }
                    if (directory.continuation != null) item {
                        TextButton(onClick = model::more, enabled = !state.loading && !state.loadingMore,
                            modifier = Modifier.fillMaxWidth()) {
                            if (state.loadingMore) CircularProgressIndicator(Modifier.size(20.dp), strokeWidth = 2.dp)
                            else Text("더 보기")
                        }
                    }
                }
            }
        }
    }
    Column(Modifier.fillMaxSize()) {
        AppTabHeader("채팅") {
            IconButton(onClick = { showingSearch = !showingSearch; if (!showingSearch) query = "" }) {
                Icon(PhosphorIcons.Regular.MagnifyingGlass, contentDescription = "대화 검색")
            }
            IconButton(onClick = { showingDiscovery = true }, enabled = directory != null) {
                Box(contentAlignment = Alignment.TopEnd) {
                    Icon(PhosphorIcons.Regular.ChatCircle, contentDescription = "새 대화 찾기")
                    Text("+", style = MaterialTheme.typography.labelSmall)
                }
            }
            IconButton(onClick = onOpenSettings) {
                Icon(PhosphorIcons.Regular.GearSix, contentDescription = "설정")
            }
        }
        Row(Modifier.fillMaxWidth().horizontalScroll(rememberScrollState())
            .padding(start = 20.dp, end = 20.dp, bottom = 12.dp),
            horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            listOf(null to "전체", RoomMode.FAN to "팬 대화", RoomMode.GROUP to "그룹 대화").forEach { (mode, label) ->
                val chosen = selectedMode == mode
                Surface(shape = CircleShape,
                    color = if (chosen) MaterialTheme.colorScheme.onSurface else MaterialTheme.colorScheme.surfaceVariant,
                    modifier = Modifier.clickable { selectedMode = mode }) {
                    Text(label, Modifier.padding(horizontal = 18.dp, vertical = 9.dp),
                        color = if (chosen) MaterialTheme.colorScheme.surface else MaterialTheme.colorScheme.onSurface,
                        style = MaterialTheme.typography.labelLarge)
                }
            }
        }
        if (showingSearch) OutlinedTextField(query, { query = it }, Modifier.fillMaxWidth()
            .padding(horizontal = 20.dp, vertical = 6.dp), singleLine = true,
            placeholder = { Text("대화 검색") })
        state.notice?.let { notice ->
            Text(notice, Modifier.fillMaxWidth().padding(horizontal = 20.dp, vertical = 12.dp),
                style = MaterialTheme.typography.bodyMedium, color = MaterialTheme.colorScheme.onSurfaceVariant)
        }
        when {
            command?.busy == true -> ScreenStatus(
                if (command.phase == RoomCommandPhase.SENDING) "요청을 처리하는 중" else "참여 상태를 확인하는 중",
                "잠시만 기다려 주세요.", loading = true)
            command?.needsVerification == true -> ScreenStatus("대화를 확인하는 중", "잠시 후 목록이 업데이트돼요.", loading = true)
            state.loading && directory == null -> ScreenStatus("대화 목록을 불러오는 중", "", loading = true)
            directory == null -> ScreenStatus("대화 목록을 확인하지 못했어요", state.error.orEmpty(), onRetry = model::reload)
            else -> LazyColumn(Modifier.fillMaxSize(), contentPadding = PaddingValues(bottom = 20.dp)) {
                item {
                    val visible = directory.memberships.filter {
                        (selectedMode == null || it.mode == selectedMode) && it.name.contains(query, ignoreCase = true)
                    }
                    if (visible.isEmpty()) Text(if (query.isNotEmpty() || selectedMode != null) "검색 결과가 없어요." else "아직 대화가 없어요. 대화를 찾아 참여해 보세요.",
                        Modifier.padding(20.dp),
                        color = MaterialTheme.colorScheme.onSurfaceVariant)
                }
                items(directory.memberships.filter {
                    (selectedMode == null || it.mode == selectedMode) && it.name.contains(query, ignoreCase = true)
                },
                    key = { "member-${it.roomId.value}" }) { room ->
                    Row(Modifier.fillMaxWidth()
                        .clickable(enabled = onOpen != null && !state.loading && !state.loadingMore) {
                            onOpen?.invoke(room, directory.cycle)
                        }.semantics { contentDescription = "${room.name} 대화 열기" }
                        .padding(horizontal = 20.dp, vertical = 10.dp),
                        verticalAlignment = Alignment.CenterVertically,
                        horizontalArrangement = Arrangement.spacedBy(14.dp)) {
                        RoomAvatar()
                        Column(Modifier.weight(1f)) {
                            Text(room.name, style = MaterialTheme.typography.titleMedium, maxLines = 1)
                            Spacer(Modifier.height(4.dp))
                            Text(if (room.mode == RoomMode.FAN) "팬 대화" else "그룹 대화",
                                style = MaterialTheme.typography.bodyMedium,
                                color = MaterialTheme.colorScheme.onSurfaceVariant, maxLines = 1)
                        }
                    }
                }
                state.error?.let { error -> item {
                    Row(Modifier.fillMaxWidth().padding(horizontal = 20.dp, vertical = 8.dp),
                        verticalAlignment = Alignment.CenterVertically) {
                        Text(error, Modifier.weight(1f), color = MaterialTheme.colorScheme.error)
                        TextButton(onClick = model::reload, enabled = !state.loading) { Text("다시 시도") }
                    }
                } }
            }
        }
    }
}

@Composable
private fun RoomAvatar() {
    Surface(Modifier.size(52.dp).clip(CircleShape), color = MaterialTheme.colorScheme.primaryContainer) {
        Box(contentAlignment = Alignment.Center) {
            Icon(PhosphorIcons.Regular.ChatCircle, null, Modifier.size(26.dp),
                tint = MaterialTheme.colorScheme.onPrimaryContainer)
        }
    }
}
