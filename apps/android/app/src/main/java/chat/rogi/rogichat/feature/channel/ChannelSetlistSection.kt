package chat.rogi.rogichat.feature.channel

import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.itemsIndexed
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import chat.rogi.rogichat.channelport.*
import chat.rogi.rogichat.channelport.core.designsystem.component.AlbumArtImage
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.launch
import java.time.Instant
import java.time.ZoneId
import java.time.format.DateTimeFormatter

private fun setlistDate(value: String): String = runCatching {
    DateTimeFormatter.ofPattern("yyyy년 M월 d일").withZone(ZoneId.of("Asia/Seoul")).format(Instant.parse(value))
}.getOrDefault("셋리스트")

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun ChannelSetlistSection(repository: ChannelSetlistRepository) {
    var rows by remember { mutableStateOf(emptyList<ChannelSetlistSummary>()) }
    var page by remember { mutableIntStateOf(1) }
    var total by remember { mutableIntStateOf(0) }
    var loading by remember { mutableStateOf(true) }
    var error by remember { mutableStateOf(false) }
    var selected by remember { mutableStateOf<ChannelSetlistSummary?>(null) }
    val scope = rememberCoroutineScope()
    suspend fun load() {
        loading = true; error = false
        try {
            val result = repository.list(page)
            rows = (rows + result.setlists).distinctBy { it.sessionId }; total = result.total; page++
        } catch (e: CancellationException) { throw e }
        catch (_: Exception) { error = true }
        finally { loading = false }
    }
    LaunchedEffect(repository) { load() }
    Column(Modifier.fillMaxWidth().padding(16.dp), verticalArrangement = Arrangement.spacedBy(12.dp)) {
        rows.forEach { row ->
            Card(Modifier.fillMaxWidth().clickable { selected = row }, colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.surfaceVariant)) {
                Row(Modifier.padding(16.dp), verticalAlignment = Alignment.CenterVertically) {
                    AlbumArtImage(imageUrl = channelImageUrl(row.albumArtPreviews.firstOrNull()), modifier = Modifier.size(56.dp))
                    Spacer(Modifier.width(12.dp))
                    Column { Text(setlistDate(row.startedAt), style = MaterialTheme.typography.titleMedium); Text("${row.completedCount}곡", style = MaterialTheme.typography.bodySmall) }
                }
            }
        }
        if (loading) CircularProgressIndicator(Modifier.align(Alignment.CenterHorizontally))
        else if (error) TextButton(onClick = { scope.launch { load() } }, modifier = Modifier.align(Alignment.CenterHorizontally)) { Text("다시 시도") }
        else if (rows.isEmpty()) Text("아직 공개된 셋리스트가 없어요", Modifier.fillMaxWidth().padding(vertical = 40.dp))
        else if (rows.size < total) TextButton(onClick = { scope.launch { load() } }, modifier = Modifier.align(Alignment.CenterHorizontally)) { Text("더 보기") }
    }
    selected?.let { row ->
        ModalBottomSheet(onDismissRequest = { selected = null }) {
            SetlistDetail(repository, row)
        }
    }
}

@Composable
private fun SetlistDetail(repository: ChannelSetlistRepository, summary: ChannelSetlistSummary) {
    var detail by remember(summary.sessionId) { mutableStateOf<ChannelSetlistDetail?>(null) }
    var error by remember(summary.sessionId) { mutableStateOf(false) }
    var retry by remember { mutableIntStateOf(0) }
    LaunchedEffect(summary.sessionId, retry) {
        error = false
        try { detail = repository.detail(summary.sessionId) }
        catch (e: CancellationException) { throw e }
        catch (_: Exception) { error = true }
    }
    Column(Modifier.fillMaxWidth().padding(bottom = 24.dp)) {
        Text(setlistDate(summary.startedAt), Modifier.padding(20.dp), style = MaterialTheme.typography.titleLarge)
        if (error) TextButton(onClick = { retry++ }) { Text("다시 시도") }
        else if (detail == null) CircularProgressIndicator(Modifier.align(Alignment.CenterHorizontally))
        else LazyColumn {
            itemsIndexed(detail!!.songs, key = { _, song -> song.id }) { index, song ->
                ListItem(headlineContent = { Text(song.title) }, supportingContent = { Text(song.artist) },
                    leadingContent = { Row(verticalAlignment = Alignment.CenterVertically) {
                        Text("${index + 1}", Modifier.width(28.dp), style = MaterialTheme.typography.labelMedium)
                        AlbumArtImage(imageUrl = channelImageUrl(song.albumArt), modifier = Modifier.size(48.dp))
                    } })
            }
        }
    }
}
