package chat.rogi.rogichat.feature.notifications

import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import chat.rogi.rogichat.core.auth.StrictAuthJson
import chat.rogi.rogichat.core.network.InvalidResponse
import chat.rogi.rogichat.core.network.ReadStateId
import chat.rogi.rogichat.feature.settings.NotificationAccountScope
import java.time.Instant
import kotlinx.coroutines.launch
import kotlinx.serialization.json.*

data class MessageSearchHit(val messageId: String, val roomId: String, val roomName: String,
    val author: String, val excerpt: String, val createdAt: Instant)
data class MessageSearchPage(val items: List<MessageSearchHit>, val nextCursor: String?)

object MessageSearchContract {
    fun page(text: String): MessageSearchPage = try {
        val root = StrictAuthJson.objectValue(text)
        val rows = root.getValue("items").jsonArray
        require(rows.size <= 30)
        val cursor = root.getValue("nextCursor").let { if (it == JsonNull) null else it.jsonPrimitive.content.also { value ->
            require(value.length <= 160 && value.matches(Regex("[A-Za-z0-9_-]+")))
        } }
        MessageSearchPage(rows.map { value ->
            val row = value.jsonObject
            val roomName = row.getValue("roomName").jsonPrimitive.content
            val author = row.getValue("author").jsonPrimitive.content
            val excerpt = row.getValue("excerpt").jsonPrimitive.content
            require(roomName.length <= 80 && author.length <= 80 && excerpt.length <= 400)
            MessageSearchHit(ReadStateId(row.getValue("messageId").jsonPrimitive.content).value,
                ReadStateId(row.getValue("roomId").jsonPrimitive.content).value, roomName, author,
                excerpt, Instant.parse(row.getValue("createdAt").jsonPrimitive.content))
        }, cursor)
    } catch (_: Exception) { throw InvalidResponse() }
}

@Composable
fun MessageSearchScreen(repository: NotificationInboxRepository, scope: NotificationAccountScope,
    onOpen: (MessageSearchHit) -> Unit) {
    var query by remember(scope) { mutableStateOf("") }
    var submitted by remember(scope) { mutableStateOf("") }
    var hits by remember(scope) { mutableStateOf(emptyList<MessageSearchHit>()) }
    var cursor by remember(scope) { mutableStateOf<String?>(null) }
    var loading by remember(scope) { mutableStateOf(false) }
    var error by remember(scope) { mutableStateOf(false) }
    val jobs = rememberCoroutineScope()
    fun search(term: String, next: String? = null) {
        if (loading) return
        loading = true; error = false
        if (next == null) { submitted = term; hits = emptyList(); cursor = null }
        jobs.launch {
            repository.searchMessages(scope, term, next).onSuccess { page ->
                hits = if (next == null) page.items else hits + page.items.filterNot { hit -> hits.any { it.messageId == hit.messageId } }
                cursor = page.nextCursor
            }.onFailure { error = true }
            loading = false
        }
    }
    Column(Modifier.fillMaxSize().padding(16.dp)) {
        Text("내가 볼 수 있는 모든 대화에서 찾습니다.", style = MaterialTheme.typography.bodyMedium)
        Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            OutlinedTextField(query, { query = it.take(100) }, label = { Text("메시지 문장 검색") },
                singleLine = true, modifier = Modifier.weight(1f))
            Button(onClick = { search(query.trim()) }, enabled = !loading && query.trim().length >= 2) { Text("검색") }
        }
        if (loading && hits.isEmpty()) CircularProgressIndicator(Modifier.padding(16.dp))
        if (error) {
            Text("검색하지 못했어요. 연결 상태를 확인해 주세요.", color = MaterialTheme.colorScheme.error)
            TextButton(onClick = { search(submitted, cursor) }) { Text("다시 시도") }
        }
        if (!loading && !error && submitted.isNotEmpty() && hits.isEmpty()) Text("찾은 메시지가 없어요.", Modifier.padding(top = 20.dp))
        LazyColumn {
            items(hits, key = { it.messageId }) { hit ->
                Column(Modifier.fillMaxWidth().clickable { onOpen(hit) }.padding(vertical = 12.dp)) {
                    Text("${hit.roomName} · ${hit.author}", style = MaterialTheme.typography.titleSmall)
                    Text(hit.excerpt, style = MaterialTheme.typography.bodyMedium)
                    Text(hit.createdAt.toString(), style = MaterialTheme.typography.labelSmall)
                }
                HorizontalDivider()
            }
            if (cursor != null) item { TextButton(onClick = { search(submitted, cursor) }, enabled = !loading) { Text("더 보기") } }
        }
    }
}
