package chat.rogi.rogichat.core.media

import java.io.File
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.runBlocking
import kotlinx.coroutines.launch
import kotlinx.coroutines.yield
import kotlinx.coroutines.delay
import kotlinx.coroutines.cancelAndJoin
import org.junit.Assert.*
import org.junit.Test

class MediaContractTest {
    @Test fun providerAvatarUsesBodylessScopedEndpointAndLease() = runBlocking {
        val own = Scope(null); var path = ""
        val transport = MediaTransport { request, _ ->
            chat.rogi.rogichat.core.network.FeatureRoutes.media(request)
            assertEquals("POST", request.method); assertNull(request.jsonBody); assertNull(request.upload)
            path = request.path
            """{"url":"https://api.qa.rogi.chat/v1/profile-images?ticket=${"a".repeat(64)}","expiresIn":60}"""
        }
        val lease = MediaClient(transport, own, "https://api.qa.rogi.chat/v1/").providerAvatar()
        assertEquals("me/provider-avatar/access", path)
        assertTrue(lease.checkedURL(own).contains("profile-images"))
        own.valid = false
        assertThrows(CancellationException::class.java) { lease.checkedURL(own) }
        val peer = MediaClient(transport, Scope(), "https://api.qa.rogi.chat/v1/")
        peer.providerAvatar(asset)
        assertEquals("rooms/$room/actors/$asset/provider-avatar/access", path)
        try { peer.providerAvatar(); fail("self endpoint admitted from room scope") } catch (_: IllegalArgumentException) { }
    }
    @Test fun providerReceiptRejectsOtherOriginsAndNonOpaquePaths() {
        val base = "https://api.qa.rogi.chat/v1/"; val ticket = "a".repeat(64)
        validateProviderAvatarURL("${base}profile-images?ticket=$ticket", base)
        for (url in listOf("https://api.rogi.chat/v1/profile-images?ticket=$ticket", "https://provider.example/image.jpg",
            "${base}profile-images/extra?ticket=$ticket", "${base}%70rofile-images?ticket=$ticket",
            "${base}profile-images?ticket=$ticket&ticket=$ticket", "${base}profile-images?ticket=$ticket&other=1",
            "${base}profile-images?ticket=short", "${base}profile-images?ticket=${"a".repeat(1025)}",
            "${base}profile-images?ticket=%61${"a".repeat(63)}", "${base}profile-images?ticket=$ticket#fragment",
            "https://user@api.qa.rogi.chat/v1/profile-images?ticket=$ticket", "https://api.qa.rogi.chat:8443/v1/profile-images?ticket=$ticket")) {
            assertThrows(IllegalArgumentException::class.java) { validateProviderAvatarURL(url, base) }
        }
        assertThrows(IllegalArgumentException::class.java) { validateProviderAvatarURL("${base}profile-images?ticket=$ticket", null) }
        MediaDownload.validateResponse(MediaVariant.image, 200, 2 * 1024 * 1024, "image/webp", null, null, provider = true)
        for ((size, type) in listOf(2 * 1024 * 1024 + 1L to "image/jpeg", 1L to "image/png")) {
            assertThrows(IllegalArgumentException::class.java) { MediaDownload.validateResponse(MediaVariant.image, 200, size, type, null, null, provider = true) }
        }
        // General uploaded PNGs retain their original contract.
        MediaDownload.validateResponse(MediaVariant.image, 200, 3 * 1024 * 1024, "image/png", null, null)
    }
    @Test fun providerGifAdmissionPreservesResponseGuards() {
        for (size in listOf(1L, 1_869_605L, 2_097_152L))
            MediaDownload.validateResponse(MediaVariant.image, 200, size, "image/gif", null, "identity", provider = true)
        for (size in listOf(-1L, 0L, 2_097_153L))
            assertThrows(IllegalArgumentException::class.java) { MediaDownload.validateResponse(MediaVariant.image, 200, size, "image/gif", null, null, provider = true) }
        assertThrows(IllegalArgumentException::class.java) { MediaDownload.validateResponse(MediaVariant.image, 200, 1, "image/gif", null, "gzip", provider = true) }
        for (status in listOf(302, 503))
            assertThrows(MediaFailure::class.java) { MediaDownload.validateResponse(MediaVariant.image, status, 1, "image/gif", null, null, provider = true) }
        assertThrows(IllegalArgumentException::class.java) { MediaDownload.validateResponse(MediaVariant.image, 200, 1, "image/gif", null, null) }
        assertThrows(IllegalArgumentException::class.java) { MediaDownload.validateResponse(MediaVariant.video, 200, 1, "image/gif", null, null, provider = true) }
    }
    @Test fun providerLoadsDeduplicateBoundTransfersAndRelease() = runBlocking {
        val loads = ProviderAvatarLoads(10); val scope = Scope()
        val started = java.util.concurrent.atomic.AtomicInteger(); val active = java.util.concurrent.atomic.AtomicInteger()
        val peak = java.util.concurrent.atomic.AtomicInteger(); val ready = java.util.concurrent.atomic.AtomicInteger()
        val load: suspend () -> ProviderAvatarState.Ready = {
            started.incrementAndGet(); val count = active.incrementAndGet(); peak.updateAndGet { maxOf(it, count) }
            try { delay(100); ProviderAvatarState.Ready(byteArrayOf(1), MediaLease("https://example.org/object", System.nanoTime() + 55_000_000_000, MediaVariant.image)) }
            finally { active.decrementAndGet() }
        }
        val same = List(5) { launch { loads.observe(scope, asset, load).collect { if (it is ProviderAvatarState.Ready) ready.incrementAndGet() } } }
        kotlinx.coroutines.withTimeout(3000) { while (ready.get() != 5) delay(5) }
        assertEquals(1, started.get())
        same.first().cancelAndJoin(); assertEquals(1, started.get())
        val distinct = List(6) { index -> launch { loads.observe(scope, "actor-$index", load).collect { } } }
        kotlinx.coroutines.withTimeout(3000) { while (started.get() < 7 || active.get() != 0) delay(5) }
        assertEquals(2, peak.get())
        (same + distinct).forEach { it.cancelAndJoin() }
        val next = launch { loads.observe(scope, asset, load).collect { } }
        kotlinx.coroutines.withTimeout(3000) { while (started.get() != 8) delay(5) }
        next.cancelAndJoin()
        kotlinx.coroutines.withTimeout(3000) { while (active.get() != 0) delay(5) }
    }
    @Test fun providerRenewalFetchesFreshBytesAndScopeCancellationDiscardsWork() = runBlocking {
        val loads = ProviderAvatarLoads(5); val scope = Scope(); val count = java.util.concurrent.atomic.AtomicInteger()
        val received = java.util.concurrent.CopyOnWriteArrayList<Int>()
        val reader = launch {
            loads.observe(scope, asset) {
                val n = count.incrementAndGet()
                ProviderAvatarState.Ready(byteArrayOf(n.toByte()), MediaLease("https://example.org/object", System.nanoTime() +
                    (if (n == 1) 20_050_000_000 else 55_000_000_000), MediaVariant.image))
            }.collect { if (it is ProviderAvatarState.Ready) received.add(it.bytes[0].toInt()) }
        }
        kotlinx.coroutines.withTimeout(3000) { while (!received.contains(2)) delay(5) }
        assertTrue(received.contains(1)); assertEquals(2, count.get())
        scope.valid = false
        kotlinx.coroutines.withTimeout(3000) { reader.join() }
        assertEquals(2, count.get())
    }
    @Test fun providerQueuedCancellationAndLateOldCompletionCannotAffectReplacement() = runBlocking {
        val loads = ProviderAvatarLoads(5); val scope = Scope()
        val entered = java.util.concurrent.atomic.AtomicInteger()
        val blocking: suspend () -> ProviderAvatarState.Ready = { entered.incrementAndGet(); delay(30000); error("unreachable") }
        val first = launch { loads.observe(scope, "first", blocking).collect { } }
        val second = launch { loads.observe(scope, "second", blocking).collect { } }
        kotlinx.coroutines.withTimeout(3000) { while (entered.get() < 2) delay(5) }
        val queued = launch { loads.observe(scope, "queued", blocking).collect { } }
        delay(80); queued.cancelAndJoin(); first.cancelAndJoin(); second.cancelAndJoin()
        delay(80); assertEquals(2, entered.get())
        val count = java.util.concurrent.atomic.AtomicInteger(); val seen = java.util.concurrent.CopyOnWriteArrayList<Int>()
        val late: suspend () -> ProviderAvatarState.Ready = {
            val n = count.incrementAndGet()
            if (n == 1) kotlinx.coroutines.withContext(kotlinx.coroutines.NonCancellable) { delay(150) }
            ProviderAvatarState.Ready(byteArrayOf(n.toByte()), MediaLease("https://example.org/object", System.nanoTime() + 55_000_000_000, MediaVariant.image))
        }
        val old = launch { loads.observe(scope, asset, late).collect { } }
        kotlinx.coroutines.withTimeout(3000) { while (count.get() == 0) delay(5) }; old.cancelAndJoin()
        val replacement = launch { loads.observe(scope, asset, late).collect { if (it is ProviderAvatarState.Ready) seen.add(it.bytes[0].toInt()) } }
        kotlinx.coroutines.withTimeout(3000) { while (seen.isEmpty()) delay(5) }
        delay(200); assertEquals(listOf(2), seen.toList()); replacement.cancelAndJoin()
    }
    @Test fun providerFailureRetriesSharedWorkWithoutKeepingOldBytes() = runBlocking {
        val loads = ProviderAvatarLoads(5); val scope = Scope(); val count = java.util.concurrent.atomic.AtomicInteger()
        val state = java.util.concurrent.atomic.AtomicReference<ProviderAvatarState>()
        val observer = launch { loads.observe(scope, asset) {
            if (count.incrementAndGet() == 1) throw MediaFailure(503, null)
            ProviderAvatarState.Ready(byteArrayOf(2), MediaLease("https://example.org/object", System.nanoTime() + 55_000_000_000, MediaVariant.image))
        }.collect { state.set(it) } }
        kotlinx.coroutines.withTimeout(3000) { while (state.get() != ProviderAvatarState.Failed) delay(5) }
        loads.retry(scope, asset)
        kotlinx.coroutines.withTimeout(3000) { while (state.get() !is ProviderAvatarState.Ready) delay(5) }
        assertEquals(2, count.get()); observer.cancelAndJoin()
    }
    private val asset = "10000000-0000-4000-8000-000000000001"
    private val room = "20000000-0000-4000-8000-000000000001"
    private inner class Scope(override val roomId: String? = room) : MediaScope {
        override val presentationID = java.util.UUID.randomUUID().toString()
        @Volatile var valid = true
        override fun check() { if (!valid) throw CancellationException() }
    }
    private fun receipt(status: String) = """{"assetId":"$asset","status":"$status"}"""
    private class Journal : MediaJournal {
        val pending = mutableListOf<PendingMedia>()
        override suspend fun save(scope: MediaScope, pending: PendingMedia) { scope.check(); this.pending.add(pending) }
        override suspend fun remove(scope: MediaScope, assetId: String) { scope.check(); pending.removeAll { it.assetId == assetId } }
    }
    @Test fun contentLimitsAndExpiry() {
        val ready = MediaReceipt(asset, MediaStatus.ready)
        assertThrows(IllegalArgumentException::class.java) { MediaContent.Attachment(MediaKind.VIDEO, listOf(ready, ready)) }
        assertThrows(IllegalArgumentException::class.java) { MediaContent.Attachment(MediaKind.PHOTO, listOf(MediaReceipt(asset, MediaStatus.processing))) }
        assertThrows(IllegalArgumentException::class.java) { MediaContent.Attachment(MediaKind.AVATAR, listOf(ready)) }
        assertEquals("STICKER", MediaContent.Sticker(asset).json()["type"].toString().trim('"'))
        assertThrows(IllegalStateException::class.java) { MediaLease("https://example.org/object", 0, MediaVariant.video).checkedURL(Scope()) }
    }
    @Test fun leaseRenewalAndPresentationIsolation() {
        val lease = MediaLease("https://example.org/object", 100_000_000_000, MediaVariant.video)
        assertFalse(lease.needsRenewal(79_000_000_000)); assertTrue(lease.needsRenewal(80_000_000_000))
        assertEquals(1000L, lease.renewalBudgetMillis(99_000_000_000)); assertEquals(0L, lease.renewalBudgetMillis(101_000_000_000))
        val context = MediaAccess.Message(room, asset, MediaVariant.video)
        val original = MediaPresentationIdentity("permit-one", asset, context)
        assertNotEquals(original, original.copy(scopeID = "permit-two"))
        assertNotEquals(original, original.copy(access = MediaAccess.Message(room, asset, MediaVariant.poster)))
    }
    @Test fun overlappingRecoveryIsRejectedAndCancellationCleansScratch() = runBlocking {
        val scratch = File.createTempFile("media-test-", ".png").apply { writeBytes(byteArrayOf(1)) }
        val client = MediaClient(MediaTransport { _, _ -> delay(30_000); receipt("reserved") }, Scope())
        val upload = MediaUpload(client, Journal())
        val task = launch { upload.start(MediaFile(scratch, MediaKind.PHOTO, "image/png")) }
        yield()
        try { upload.recover(PendingMedia(asset, MediaKind.PHOTO)); fail("overlap admitted") } catch (_: IllegalStateException) { }
        task.cancelAndJoin(); assertFalse(scratch.exists()); assertEquals(MediaUploadState.Cancelled, upload.state)
    }
    @Test fun rangeAndVideoLimits() {
        MediaDownload.validateResponse(MediaVariant.video, 206, 20, "video/mp4", "bytes 0-19/20", null)
        MediaDownload.validateResponse(MediaVariant.video, 200, 20, "video/mp4", null, "identity")
        assertThrows(IllegalArgumentException::class.java) { MediaDownload.validateResponse(MediaVariant.video, 206, 20, "video/mp4", "bytes 20-39/40", null) }
        assertThrows(IllegalArgumentException::class.java) { MediaDownload.validateResponse(MediaVariant.video, 200, 20, "text/html", null, null) }
        assertThrows(MediaFailure::class.java) { MediaDownload.validateResponse(MediaVariant.video, 403, 20, "video/mp4", null, null) }
        assertThrows(IllegalArgumentException::class.java) { MediaIntent(MediaKind.VIDEO, "video/mp4", 50L * 1024 * 1024 + 1, room) }
        assertThrows(IllegalArgumentException::class.java) { MediaIntent(MediaKind.AVATAR, "image/jpeg", 3, room) }
        assertThrows(IllegalArgumentException::class.java) { MediaIntent(MediaKind.PHOTO, "image/heic", 3, room) }
    }
    @Test fun successfulUploadAndStatusOnlyRecovery() = runBlocking {
        val calls = mutableListOf<MediaRequest>()
        val responses = ArrayDeque(listOf(receipt("reserved"), receipt("processing"), receipt("ready"), """{"id":"$asset","avatar":null}""", receipt("ready")))
        val client = MediaClient(MediaTransport { request, _ -> calls.add(request); responses.removeFirst() }, Scope())
        val journal = Journal(); val upload = MediaUpload(client, journal)
        val scratch = File.createTempFile("media-test-", ".mp4").apply { writeBytes(byteArrayOf(1, 2, 3)) }
        val ready = upload.start(MediaFile(scratch, MediaKind.VIDEO, "video/mp4"))
        assertEquals(MediaStatus.ready, ready.status); assertFalse(scratch.exists())
        assertEquals(listOf(201, 202, 200), calls.map { it.expectedStatus })
        assertEquals(3L, calls[1].upload?.byteLength); assertNull(calls[1].jsonBody)
        assertEquals(1, journal.pending.size)
        MediaClient(MediaTransport { request, _ -> calls.add(request); responses.removeFirst() }, Scope(null)).updateAvatar(null); assertEquals("{\"avatarAssetId\":null}", calls.last().jsonBody)
        upload.acknowledged(asset); assertTrue(journal.pending.isEmpty())
        upload.recover(PendingMedia(asset, MediaKind.VIDEO)); assertEquals("GET", calls.last().method)
    }
    @Test fun originalScopeAndFailureCleanup() = runBlocking {
        val scope = Scope()
        val client = MediaClient(MediaTransport { _, _ -> scope.valid = false; receipt("ready") }, scope)
        try { client.status(asset); fail("stale response escaped") } catch (_: CancellationException) { }
        val responses = ArrayDeque(listOf(receipt("reserved")))
        val failing = MediaClient(MediaTransport { _, _ -> if (responses.isEmpty()) throw MediaFailure(403, "FORBIDDEN"); responses.removeFirst() }, Scope())
        val scratch = File.createTempFile("media-test-", ".png").apply { writeBytes(byteArrayOf(1)) }
        val upload = MediaUpload(failing, Journal())
        try { upload.start(MediaFile(scratch, MediaKind.PHOTO, "image/png")); fail("expected error") } catch (e: MediaFailure) { assertEquals(403, e.status) }
        assertFalse(scratch.exists()); assertEquals(asset, (upload.state as MediaUploadState.Failed).pending?.assetId)
    }
}
