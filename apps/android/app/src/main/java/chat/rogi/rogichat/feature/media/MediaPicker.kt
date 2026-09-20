package chat.rogi.rogichat.feature.media

import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.PickVisualMediaRequest
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.*
import androidx.compose.ui.platform.LocalContext
import chat.rogi.rogichat.core.media.*
import java.io.File
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.ensureActive
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext

/** Adapted from ChannelSettingsScreen photoPickerLauncher at Meloming ecb3dbed.
 * Preserve platform picker/URI resolver flow; stream bounded private scratch off the UI thread.
 * Unsupported HEIC/animated assets are not mislabeled JPEG or reported uploaded. */
@Composable
fun MediaPicker(kind: MediaKind, enabled: Boolean, scope: MediaScope, onSelected: suspend (MediaFile) -> Unit,
                onFailure: (Throwable) -> Unit) {
    val context = LocalContext.current
    val jobs = rememberCoroutineScope()
    var importing by remember { mutableStateOf(false) }
    val launcher = rememberLauncherForActivityResult(ActivityResultContracts.PickVisualMedia()) { uri ->
        if (uri != null) jobs.launch {
            importing = true
            var imported: MediaFile? = null
            var pendingScratch: File? = null
            try {
                MediaScratchPreparation.prepare(context.cacheDir)
                scope.check()
                imported = withContext(Dispatchers.IO) {
                    val type = context.contentResolver.getType(uri)
                    require(type in kind.types)
                    val scratch = File.createTempFile("media-pick-", ".upload", context.cacheDir)
                    pendingScratch = scratch
                    try {
                        requireNotNull(context.contentResolver.openInputStream(uri)).use { input -> scratch.outputStream().use { output ->
                            val buffer = ByteArray(65536); var count = 0L
                            while (true) { ensureActive(); scope.check(); val size = input.read(buffer); if (size < 0) break
                                count += size; require(count <= kind.maxBytes); output.write(buffer, 0, size) }
                        } }
                        MediaFile(scratch, kind, requireNotNull(type))
                    } catch (error: Throwable) { scratch.delete(); throw error }
                }
                scope.check(); onSelected(requireNotNull(imported))
            } catch (error: kotlinx.coroutines.CancellationException) { throw error }
            catch (error: Exception) { onFailure(error) }
            finally { imported?.close(); pendingScratch?.delete(); importing = false }
        }
    }
    Text(if (kind == MediaKind.VIDEO) "MP4·MOV, 최대 50MB" else "JPEG·PNG·WebP, 최대 10MB", style = androidx.compose.material3.MaterialTheme.typography.bodySmall)
    TextButton(enabled = enabled && !importing, onClick = {
        launcher.launch(PickVisualMediaRequest(if (kind == MediaKind.VIDEO) ActivityResultContracts.PickVisualMedia.VideoOnly else ActivityResultContracts.PickVisualMedia.ImageOnly))
    }) { Text(if (importing) "파일을 준비하고 있어요" else when (kind) { MediaKind.PHOTO -> "사진 선택"; MediaKind.VIDEO -> "동영상 선택"; MediaKind.AVATAR -> "프로필 사진 변경" }) }
}
