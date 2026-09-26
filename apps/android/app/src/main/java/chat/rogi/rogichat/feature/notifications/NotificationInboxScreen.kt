package chat.rogi.rogichat.feature.notifications

import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.lazy.rememberLazyListState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.lifecycle.ViewModel
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.lifecycle.viewModelScope
import chat.rogi.rogichat.core.auth.StrictAuthJson
import chat.rogi.rogichat.core.network.ReadStateId
import chat.rogi.rogichat.feature.settings.NotificationAccountScope
import com.adamglin.PhosphorIcons
import com.adamglin.phosphoricons.Fill
import com.adamglin.phosphoricons.fill.Bell
import java.time.Duration
import java.time.Instant
import java.time.ZoneId
import java.time.format.DateTimeFormatter
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch
import kotlinx.serialization.json.*

// Adapted from Meloming feature/notifications NotificationsUiState,
// NotificationsViewModel and NotificationsScreen. The live repository and
// message authorization are Rogichat-specific; no Meloming URL is accepted.
data class InboxNotification(val id: String, val title: String, val body: String,
    val roomId: String, val createdAt: Instant, val readAt: Instant?) {
    val isRead get() = readAt != null
}
data class InboxPage(val items: List<InboxNotification>, val nextCursor: String?)
interface NotificationInboxRepository {
    suspend fun getInbox(scope: NotificationAccountScope, cursor: String? = null): Result<InboxPage>
    suspend fun markInboxRead(scope: NotificationAccountScope, id: String): Result<Unit>
}
object InboxContract {
    fun page(text: String): InboxPage = try {
        val root = StrictAuthJson.objectValue(text)
        val rows = root.getValue("items").jsonArray
        require(rows.size <= 20)
        val cursor = root.getValue("nextCursor").let { if (it == JsonNull) null else it.jsonPrimitive.content.also { value ->
            require(value.length <= 160 && value.matches(Regex("[A-Za-z0-9_-]+")))
        } }
        InboxPage(rows.map { value ->
            val item = value.jsonObject
            require(item.getValue("type").jsonPrimitive.content == "MESSAGE")
            require(item.getValue("url").jsonPrimitive.content == "/chat")
            val title = item.getValue("title").jsonPrimitive.content
            val body = item.getValue("body").jsonPrimitive.content
            require(title.length <= 80 && body.length <= 120)
            InboxNotification(ReadStateId(item.getValue("id").jsonPrimitive.content).value, title, body,
                ReadStateId(item.getValue("roomId").jsonPrimitive.content).value,
                Instant.parse(item.getValue("createdAt").jsonPrimitive.content),
                item.getValue("readAt").let { if (it == JsonNull) null else Instant.parse(it.jsonPrimitive.content) })
        }, cursor)
    } catch (_: Exception) { throw chat.rogi.rogichat.core.network.InvalidResponse() }
}

data class InboxState(val loading: Boolean = true, val loadingMore: Boolean = false,
    val items: List<InboxNotification> = emptyList(), val nextCursor: String? = null,
    val error: String? = null, val markingAll: Boolean = false)

class NotificationInboxViewModel(private val repository: NotificationInboxRepository,
    private val account: NotificationAccountScope) : ViewModel() {
    private val mutable = MutableStateFlow(InboxState())
    val state = mutable.asStateFlow()
    init { refresh() }
    fun refresh() { viewModelScope.launch {
        mutable.update { it.copy(loading = true, error = null) }
        val result = repository.getInbox(account)
        result.onSuccess { page -> mutable.value = InboxState(items = page.items, nextCursor = page.nextCursor) }
            .onFailure { if (it is CancellationException) throw it
                mutable.update { state -> state.copy(loading = false, error = "알림을 불러오지 못했어요. 다시 시도해 주세요.") } }
    } }
    fun loadMore() {
        val cursor = mutable.value.nextCursor ?: return
        if (mutable.value.loadingMore) return
        viewModelScope.launch {
            mutable.update { it.copy(loadingMore = true) }
            repository.getInbox(account, cursor).onSuccess { page ->
                mutable.update { state -> state.copy(loadingMore = false,
                    items = state.items + page.items.filterNot { item -> state.items.any { it.id == item.id } },
                    nextCursor = page.nextCursor, error = null) }
            }.onFailure { if (it is CancellationException) throw it
                mutable.update { state -> state.copy(loadingMore = false, error = "알림을 더 불러오지 못했어요.") } }
        }
    }
    fun open(item: InboxNotification, onOpenTalks: () -> Unit) { viewModelScope.launch {
        if (!item.isRead) repository.markInboxRead(account, item.id).onSuccess {
            mutable.update { state -> state.copy(items = state.items.map { current ->
                if (current.id == item.id) current.copy(readAt = Instant.now()) else current }) }
        }.onFailure { if (it is CancellationException) throw it
            mutable.update { state -> state.copy(error = "읽음 상태를 저장하지 못했어요.") } }
        onOpenTalks()
    } }
    fun markAll() { if (mutable.value.markingAll) return
        viewModelScope.launch {
            mutable.update { it.copy(markingAll = true) }
            for (item in mutable.value.items.filterNot { it.isRead }) {
                val result = repository.markInboxRead(account, item.id)
                if (result.isFailure) { mutable.update { it.copy(error = "일부 알림의 읽음 상태를 저장하지 못했어요.") }; break }
                mutable.update { state -> state.copy(items = state.items.map { current ->
                    if (current.id == item.id) current.copy(readAt = Instant.now()) else current }) }
            }
            mutable.update { it.copy(markingAll = false) }
        }
    }
}

@Composable
fun NotificationInboxScreen(model: NotificationInboxViewModel, onOpenTalks: () -> Unit, onSettings: () -> Unit) {
    val state by model.state.collectAsStateWithLifecycle()
    Column(Modifier.fillMaxSize()) {
        Row(Modifier.fillMaxWidth().padding(horizontal = 16.dp, vertical = 8.dp),
            horizontalArrangement = Arrangement.End, verticalAlignment = Alignment.CenterVertically) {
            TextButton(onClick = onSettings) { Text("알림 설정") }
            TextButton(onClick = model::refresh, enabled = !state.loading) { Text("새로고침") }
            if (state.items.any { !it.isRead }) TextButton(onClick = model::markAll, enabled = !state.markingAll) { Text("모두 읽기") }
        }
        Box(Modifier.fillMaxSize()) {
            when {
                state.loading && state.items.isEmpty() -> CircularProgressIndicator(Modifier.align(Alignment.Center))
                state.items.isEmpty() -> Column(Modifier.align(Alignment.Center), horizontalAlignment = Alignment.CenterHorizontally) {
                    Icon(PhosphorIcons.Fill.Bell, null, Modifier.size(44.dp), MaterialTheme.colorScheme.primary)
                    Spacer(Modifier.height(12.dp))
                    Text(if (state.error == null) "알림이 없습니다" else "알림을 불러올 수 없어요", style = MaterialTheme.typography.titleMedium)
                    Text(state.error ?: "새로운 알림이 도착하면 여기에 표시됩니다", color = MaterialTheme.colorScheme.onSurfaceVariant)
                    if (state.error != null) TextButton(onClick = model::refresh) { Text("다시 시도") }
                }
                else -> {
                    val listState = rememberLazyListState()
                    LaunchedEffect(listState, state.nextCursor, state.loadingMore) {
                        snapshotFlow { listState.layoutInfo.visibleItemsInfo.lastOrNull()?.index ?: 0 }
                            .collect { last -> if (state.nextCursor != null && !state.loadingMore && state.error == null && last >= state.items.size - 2) model.loadMore() }
                    }
                    LazyColumn(state = listState) {
                        items(state.items, key = { it.id }) { item ->
                            Row(Modifier.fillMaxWidth().clickable { model.open(item, onOpenTalks) }
                                .background(if (item.isRead) Color.Transparent else MaterialTheme.colorScheme.primaryContainer.copy(alpha = 0.12f))
                                .padding(horizontal = 16.dp, vertical = 12.dp), verticalAlignment = Alignment.Top) {
                                Box(Modifier.size(40.dp).clip(CircleShape).background(MaterialTheme.colorScheme.primaryContainer), contentAlignment = Alignment.Center) {
                                    Icon(PhosphorIcons.Fill.Bell, null, Modifier.size(20.dp), MaterialTheme.colorScheme.primary)
                                }
                                Spacer(Modifier.width(12.dp))
                                Column(Modifier.weight(1f)) {
                                    Text(item.title, fontWeight = if (item.isRead) FontWeight.Normal else FontWeight.Bold,
                                        maxLines = 1, overflow = TextOverflow.Ellipsis)
                                    Text(item.body, style = MaterialTheme.typography.bodySmall,
                                        color = MaterialTheme.colorScheme.onSurfaceVariant, maxLines = 2)
                                    Text(relativeTime(item.createdAt), style = MaterialTheme.typography.labelSmall,
                                        color = MaterialTheme.colorScheme.onSurfaceVariant)
                                }
                                if (!item.isRead) Box(Modifier.size(8.dp).clip(CircleShape).background(MaterialTheme.colorScheme.primary))
                            }
                            HorizontalDivider()
                        }
                        if (state.loadingMore) item { CircularProgressIndicator(Modifier.padding(16.dp).size(24.dp)) }
                        if (state.error != null) item { Text(state.error!!, Modifier.padding(16.dp), color = MaterialTheme.colorScheme.error) }
                    }
                }
            }
        }
    }
}

private fun relativeTime(created: Instant): String {
    val elapsed = Duration.between(created, Instant.now())
    return when {
        elapsed.toMinutes() < 1 -> "방금 전"
        elapsed.toHours() < 1 -> "${elapsed.toMinutes()}분 전"
        elapsed.toDays() < 1 -> "${elapsed.toHours()}시간 전"
        elapsed.toDays() < 7 -> "${elapsed.toDays()}일 전"
        else -> DateTimeFormatter.ofPattern("M월 d일").withZone(ZoneId.systemDefault()).format(created)
    }
}
