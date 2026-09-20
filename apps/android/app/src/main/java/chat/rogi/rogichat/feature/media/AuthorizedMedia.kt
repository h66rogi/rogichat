package chat.rogi.rogichat.feature.media

import android.graphics.BitmapFactory
import android.net.Uri
import android.widget.MediaController
import android.widget.VideoView
import androidx.compose.foundation.Image
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.size
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.asImageBitmap
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.unit.dp
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.viewinterop.AndroidView
import chat.rogi.rogichat.core.media.*
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.delay
import kotlinx.coroutines.withContext

/** Mount with key(original ConversationScope, assetId, access context). Disposal stops playback and
 * deletes private scratch. The server rendition is H.264/AAC MP4, poster is WebP. */
@Composable
fun AuthorizedMedia(client: MediaClient, assetId: String, access: MediaAccess, modifier: Modifier = Modifier, avatar: Boolean = false) {
    key(MediaPresentationIdentity(client.scope.presentationID, assetId, access)) {
        AuthorizedMediaBody(client, assetId, access, modifier, avatar)
    }
}

@Composable
private fun AuthorizedMediaBody(client: MediaClient, assetId: String?, access: MediaAccess, modifier: Modifier, avatar: Boolean) {
    val context = LocalContext.current
    var retry by remember { mutableIntStateOf(0) }
    var file by remember { mutableStateOf<java.io.File?>(null) }
    var bitmap by remember { mutableStateOf<androidx.compose.ui.graphics.ImageBitmap?>(null) }
    var failed by remember { mutableStateOf(false) }
    LaunchedEffect(client, assetId, access, retry) {
        failed = false; file = null; bitmap = null
        var scratch: java.io.File? = null
        try {
            var lease = client.access(requireNotNull(assetId), access)
            val downloaded = MediaDownload.fetch(lease, client.scope, context.cacheDir)
            scratch = downloaded
            if (access.variant != MediaVariant.video) {
                bitmap = withContext(Dispatchers.IO) {
                    val bounds = BitmapFactory.Options().apply { inJustDecodeBounds = true }
                    BitmapFactory.decodeFile(downloaded.path, bounds)
                    require(bounds.outWidth > 0 && bounds.outHeight > 0 && bounds.outWidth.toLong() * bounds.outHeight <= 20_000_000)
                    val options = BitmapFactory.Options().apply { inSampleSize = maxOf(1, maxOf(bounds.outWidth, bounds.outHeight) / 2048) }
                    requireNotNull(BitmapFactory.decodeFile(downloaded.path, options)).asImageBitmap()
                }
            }
            lease.checkedURL(client.scope); file = scratch
            while (true) {
                delay(250); lease.checkedURL(client.scope)
                if (lease.needsRenewal()) {
                    lease = client.renewAccess(requireNotNull(assetId), access, lease)
                }
            }
        } catch (_: kotlinx.coroutines.TimeoutCancellationException) { failed = true }
        catch (error: kotlinx.coroutines.CancellationException) { throw error }
        catch (_: Exception) { failed = true }
        finally { file = null; bitmap = null; scratch?.delete() }
    }
    Column(modifier) {
        if (failed) {
            if (!avatar) Text("미디어를 표시할 수 없어요.")
            TextButton(onClick = { retry++ }) { Text("다시 시도") }
        } else if (file == null) { CircularProgressIndicator(Modifier.size(if (avatar) 24.dp else 48.dp)) }
        else if (access.variant == MediaVariant.video) {
            AndroidView(factory = { ctx -> VideoView(ctx).apply {
                setMediaController(MediaController(ctx).also { it.setAnchorView(this) })
                setOnErrorListener { _, _, _ -> failed = true; true }
                setVideoURI(Uri.fromFile(file))
            } }, onReset = null, onRelease = { it.stopPlayback() }, update = {})
        } else { bitmap?.let { Image(it, contentDescription = if (avatar) "프로필 사진" else "첨부 이미지",
            modifier = if (avatar) Modifier.fillMaxSize() else Modifier,
            contentScale = if (avatar) ContentScale.Crop else ContentScale.Fit) } }
    }
}

@Composable
fun AuthorizedProviderAvatar(client: MediaClient, modifier: Modifier = Modifier, actorId: String? = null) {
    key(client.scope.presentationID, actorId, "provider-avatar") {
        val cache = LocalContext.current.cacheDir
        var bitmap by remember { mutableStateOf<androidx.compose.ui.graphics.ImageBitmap?>(null) }
        var failed by remember { mutableStateOf(false) }
        var retry by remember { mutableIntStateOf(0) }
        LaunchedEffect(client.scope.presentationID, actorId, retry) {
            bitmap = null; failed = false
            try {
                ProviderAvatarLoads.shared.observe(client.scope, actorId) {
                    val lease = client.providerAvatar(actorId)
                    val file = MediaDownload.fetch(lease, client.scope, cache, provider = true)
                    try { ProviderAvatarState.Ready(file.readBytes(), lease) } finally { file.delete() }
                }.collect { state ->
                    bitmap = null; failed = state == ProviderAvatarState.Failed
                    if (state is ProviderAvatarState.Ready) {
                        state.lease.checkedURL(client.scope)
                        val decoded = withContext(Dispatchers.Default) {
                            val bytes = state.bytes
                            val bounds = BitmapFactory.Options().apply { inJustDecodeBounds = true }
                            BitmapFactory.decodeByteArray(bytes, 0, bytes.size, bounds)
                            require(bounds.outWidth > 0 && bounds.outHeight > 0 && bounds.outWidth.toLong() * bounds.outHeight <= 20_000_000)
                            val options = BitmapFactory.Options().apply { inSampleSize = maxOf(1, maxOf(bounds.outWidth, bounds.outHeight) / 256) }
                            requireNotNull(BitmapFactory.decodeByteArray(bytes, 0, bytes.size, options)).asImageBitmap()
                        }
                        state.lease.checkedURL(client.scope); bitmap = decoded
                    }
                }
            } catch (error: kotlinx.coroutines.CancellationException) { throw error }
            catch (_: Exception) { failed = true }
            finally { bitmap = null }
        }
        Column(modifier) {
            if (failed) TextButton(onClick = { runCatching { ProviderAvatarLoads.shared.retry(client.scope, actorId) }; retry++ }) { Text("다시 시도") }
            else if (bitmap == null) CircularProgressIndicator(Modifier.size(24.dp))
            else Image(requireNotNull(bitmap), contentDescription = "프로필 사진", modifier = Modifier.fillMaxSize(), contentScale = ContentScale.Crop)
        }
    }
}
