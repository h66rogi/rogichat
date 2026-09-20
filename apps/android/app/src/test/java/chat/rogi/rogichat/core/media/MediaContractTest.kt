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
            """{"url":"https://api.qa.rogi.chat/v1/profile-images?ticket=opaque","expiresIn":60}"""
        }
        val lease = MediaClient(transport, own).providerAvatar()
        assertEquals("me/provider-avatar/access", path)
        assertTrue(lease.checkedURL(own).contains("profile-images"))
        own.valid = false
        assertThrows(CancellationException::class.java) { lease.checkedURL(own) }
        val peer = MediaClient(transport, Scope())
        peer.providerAvatar(asset)
        assertEquals("rooms/$room/actors/$asset/provider-avatar/access", path)
        try { peer.providerAvatar(); fail("self endpoint admitted from room scope") } catch (_: IllegalArgumentException) { }
    }
    private val asset = "10000000-0000-4000-8000-000000000001"
    private val room = "20000000-0000-4000-8000-000000000001"
    private inner class Scope(override val roomId: String? = room) : MediaScope {
        override val presentationID = java.util.UUID.randomUUID().toString()
        var valid = true
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
