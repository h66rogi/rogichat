package chat.rogi.rogichat.feature.media

import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.size
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.material3.*
import androidx.compose.runtime.*
import chat.rogi.rogichat.core.media.*
import kotlinx.coroutines.launch

@Composable
fun StickerPicker(client: MediaClient, onSelect: suspend (MediaContent.Sticker) -> Unit) {
    var stickers by remember(client) { mutableStateOf<List<MediaSticker>>(emptyList()) }
    var next by remember(client) { mutableStateOf<String?>(null) }
    var loaded by remember(client) { mutableStateOf(false) }
    var busy by remember { mutableStateOf(false) }
    var failed by remember { mutableStateOf(false) }
    val jobs = rememberCoroutineScope()
    suspend fun load() {
        busy = true; failed = false
        try {
            val page = client.stickers(if (loaded) next else null)
            client.scope.check()
            require(page.nextCursor == null || page.nextCursor != next)
            stickers = (stickers + page.items).distinctBy { it.id }; next = page.nextCursor; loaded = true
        } catch (error: kotlinx.coroutines.CancellationException) { throw error }
        catch (_: Exception) { failed = true }
        finally { busy = false }
    }
    LaunchedEffect(client) { load() }
    Column {
        if (busy) LinearProgressIndicator()
        if (failed) { Text("스티커를 불러오거나 선택하지 못했어요."); TextButton(onClick = { jobs.launch { load() } }) { Text("다시 시도") } }
        if (loaded && stickers.isEmpty()) Text("사용할 수 있는 스티커가 없어요.")
        LazyColumn { items(stickers, key = { it.id }) { sticker ->
            AuthorizedMedia(client, sticker.assetId, MediaAccess.Sticker(requireNotNull(client.scope.roomId), sticker.id), Modifier.size(72.dp))
            TextButton(enabled = !busy, onClick = { jobs.launch {
                busy = true
                try { client.scope.check(); onSelect(MediaContent.Sticker(sticker.id)) }
                catch (error: kotlinx.coroutines.CancellationException) { throw error }
                catch (_: Exception) { failed = true }
                finally { busy = false }
            } }) { Text(sticker.label) }
        } }
        if (loaded && next != null) TextButton(enabled = !busy, onClick = { jobs.launch { load() } }) { Text("더 보기") }
    }
}

@Composable
fun AvatarPicker(client: MediaClient, journal: MediaJournal, onUpdated: suspend () -> Unit, onFailure: (Throwable) -> Unit) {
    var busy by remember { mutableStateOf(false) }
    val upload = remember(client, journal) { MediaUpload(client, journal) }
    MediaPicker(MediaKind.AVATAR, !busy, client.scope, onSelected = { file ->
        busy = true
        try {
            val ready = upload.start(file)
            client.updateAvatar(ready); client.scope.check()
            upload.acknowledged(ready.assetId); onUpdated()
        } finally { busy = false }
    }, onFailure = onFailure)
}
