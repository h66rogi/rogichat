package chat.rogi.rogichat.core.media

import java.io.File
import okhttp3.*
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.currentCoroutineContext
import kotlinx.coroutines.ensureActive
import kotlinx.coroutines.withContext
import kotlinx.coroutines.launch
import kotlinx.coroutines.delay

/** Credential-free, redirect-free object download. Video uses a real Range GET and is staged
 * privately so native seek does not retain an expired signed URL. Never persist this scratch path. */
object MediaDownload {
    suspend fun fetch(lease: MediaLease, scope: MediaScope, cacheDirectory: File, provider: Boolean = false): File {
        MediaScratchPreparation.prepare(cacheDirectory)
        var scratch: File? = null
        try { return withContext(Dispatchers.IO) {
        val video = lease.variant == MediaVariant.video
        val cap = if (provider) 2L * 1024 * 1024 else if (video) 52L * 1024 * 1024 else 10L * 1024 * 1024
        val client = OkHttpClient.Builder().followRedirects(false).followSslRedirects(false)
            .cookieJar(CookieJar.NO_COOKIES).authenticator(Authenticator.NONE).proxyAuthenticator(Authenticator.NONE)
            .retryOnConnectionFailure(false).cache(null).callTimeout(java.time.Duration.ofMinutes(3)).build()
        val request = Request.Builder().url(lease.checkedURL(scope)).header("Accept-Encoding", "identity")
            .apply { if (video) header("Range", "bytes=0-") }.build()
        val call = client.newCall(request)
        val file = File.createTempFile("media-display-", if (video) ".mp4" else ".image", cacheDirectory)
        scratch = file
        val monitor = launch(Dispatchers.Default) {
            try { while (true) { delay(250); scope.check() } }
            finally { call.cancel() }
        }
        try {
            call.execute().use { response ->
            val status = response.code
            val expected = response.body.contentLength()
            validateResponse(lease.variant, status, expected, response.header("Content-Type")?.substringBefore(';'),
                response.header("Content-Range"), response.header("Content-Encoding"), provider)
            requireNotNull(response.body).byteStream().use { source -> file.outputStream().use { sink ->
                val buffer = ByteArray(65536); var total = 0L
                while (true) {
                    currentCoroutineContext().ensureActive(); scope.check()
                    val size = source.read(buffer); if (size < 0) break
                    total += size; require(total <= expected && total <= cap); sink.write(buffer, 0, size)
                }
                require(total == expected)
            } }
            scope.check(); file
            }
        } catch (error: Throwable) { file.delete(); throw error }
        finally { monitor.cancel(); call.cancel(); client.connectionPool.evictAll(); client.dispatcher.executorService.shutdown() }
        } } catch (error: Throwable) { scratch?.delete(); throw error }
    }
    internal fun validateResponse(variant: MediaVariant, status: Int, length: Long, type: String?, range: String?, encoding: String?, provider: Boolean = false) {
        val video = variant == MediaVariant.video
        val cap = if (provider) 2L * 1024 * 1024 else if (video) 52L * 1024 * 1024 else 10L * 1024 * 1024
        if (status !in (if (video) setOf(200, 206) else setOf(200))) throw MediaFailure(status, null)
        require(if (provider) !video && type in setOf("image/jpeg", "image/webp", "image/gif") else if (video) type == "video/mp4" else type in setOf("image/jpeg", "image/png", "image/webp"))
        require(encoding == null || encoding == "identity")
        require(length in 1..cap)
        if (status == 206) require(range == "bytes 0-${length - 1}/$length")
    }

}

/** Invoke once before starting any media jobs at process startup, never during active transfers. */
fun purgeMediaScratchAtProcessStart(cacheDirectory: File) {
    check(cacheDirectory.isDirectory)
    val files = requireNotNull(cacheDirectory.listFiles())
    files.filter { it.isFile && (it.name.startsWith("media-pick-") || it.name.startsWith("media-display-")) }
        .forEach { check(it.delete()) { "media_cleanup_failed" } }
}
