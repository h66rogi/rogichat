package chat.rogi.rogichat.core.media

import java.io.File
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock

/** One cleanup before any picker/download file is created; never purge active media jobs. */
object MediaScratchPreparation {
    private val lock = Mutex()
    private var prepared: File? = null
    suspend fun prepare(directory: File) = lock.withLock {
        val canonical = directory.canonicalFile
        if (prepared == canonical) return@withLock
        check(prepared == null)
        withContext(Dispatchers.IO) { purgeMediaScratchAtProcessStart(canonical) }
        prepared = canonical
    }
}
