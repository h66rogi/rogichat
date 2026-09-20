package chat.rogi.rogichat.core

import chat.rogi.rogichat.core.auth.*
import chat.rogi.rogichat.core.identity.*
import chat.rogi.rogichat.core.network.*
import chat.rogi.rogichat.core.media.*
import chat.rogi.rogichat.core.messageactions.*
import chat.rogi.rogichat.core.push.*
import chat.rogi.rogichat.core.conversation.*
import chat.rogi.rogichat.core.session.*
import io.ktor.client.engine.mock.*
import io.ktor.http.*
import java.time.Clock
import java.time.ZoneOffset
import java.util.concurrent.atomic.AtomicBoolean
import javax.crypto.KeyGenerator
import kotlinx.coroutines.async
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.test.runTest
import org.junit.Assert.*
import org.junit.Test

class FeatureTransportTest {
    @Test fun applePublicAdmissionCanStopAtActualHttpPipelineWithoutSendingAndLinkPreservesBearer() = runTest {
        var calls = 0
        val client = ApiClient("https://api.qa.rogi.chat/v1/", MockEngine { request ->
            calls++
            assertEquals("api.qa.rogi.chat", request.url.host)
            assertNull(request.headers["Cookie"]); assertNull(request.headers["Origin"])
            assertEquals("android", request.headers["X-Rogi-Client"])
            assertEquals("Bearer $TOKEN", request.headers[HttpHeaders.Authorization])
            respond("{}", HttpStatusCode.OK)
        })
        val active = AtomicBoolean(true)
        val admission = AuthHttpAdmission(Clock.fixed(NOW, ZoneOffset.UTC), EXPIRY) { active.get() }
        active.set(false)
        assertTrue(runCatching { client.performAppleAdmitted(AppleIdentityRoute.START, IdentityIntent.LOGIN, null, "{}", admission::claim) }.exceptionOrNull() is CancellationException)
        assertEquals(0, calls)
        client.performAppleAdmitted(AppleIdentityRoute.EXCHANGE, IdentityIntent.LINK, TOKEN, "{}") {}
        assertEquals(1, calls)
        client.close()
    }
    @Test fun authAdmissionIsOneShotAndDeadlineIsCheckedAtClaim() {
        val permit = AuthHttpAdmission(Clock.fixed(NOW, ZoneOffset.UTC), EXPIRY) { true }
        permit.claim()
        assertThrows(CancellationException::class.java) { permit.claim() }
        assertThrows(CancellationException::class.java) { AuthHttpAdmission(Clock.fixed(EXPIRY, ZoneOffset.UTC), EXPIRY) { true }.claim() }
    }
    @Test fun actionTransportUsesTypedQueryAndRejectsUrlEscapeBeforeNetwork() = runTest {
        var calls = 0
        val client = ApiClient("https://api.qa.rogi.chat/v1/", MockEngine { request ->
            calls++; assertEquals(OTHER, request.url.parameters["after"])
            assertEquals("Bearer $TOKEN", request.headers[HttpHeaders.Authorization])
            respond("{}", HttpStatusCode.OK)
        })
        assertTrue(runCatching { client.messageAction(TOKEN, ActionRequest("GET", "https://example.invalid", null, 200)) }.isFailure)
        assertTrue(runCatching { client.messageAction(TOKEN, ActionRequest("GET", "rooms/$OWN/blocks?after=$OTHER", null, 200)) }.isFailure)
        assertTrue(runCatching { client.messageAction(TOKEN, ActionRequest("POST", "rooms/$OWN/blocks", "{}", 200)) }.isFailure)
        client.messageAction(TOKEN, ActionRequest("GET", "rooms/$OWN/blocks", null, 200, mapOf("after" to OTHER)))
        assertEquals(1, calls); client.close()
    }
    @Test fun queuedConversationMutationsRequireOriginalScopeAtActualHttpSend() = runTest {
        var requests = 0
        val client = ApiClient("https://api.qa.rogi.chat/v1/", MockEngine { requests++; respond("{}", HttpStatusCode.OK) })
        val original = AtomicBoolean(true)
        val entered = kotlinx.coroutines.CompletableDeferred<Unit>(); val released = kotlinx.coroutines.CompletableDeferred<Unit>()
        val gate = { if (!original.get()) throw CancellationException("original_scope_closed") }
        val sending = async {
            entered.complete(Unit); released.await()
            client.sendTextAdmitted(TOKEN, CONVERSATION_ID, TextCommand(ACTOR_ID, SCOPE_M, "SHARED", null, null, "실제 전송 의도"), gate)
        }
        entered.await(); original.set(false); released.complete(Unit)
        assertTrue(runCatching { sending.await() }.exceptionOrNull() is CancellationException)
        assertTrue(runCatching { client.messageActionAdmitted(TOKEN, ActionRequest("PUT", "rooms/${CONVERSATION_ID.value}/read-state", "{}", 200), gate) }.exceptionOrNull() is CancellationException)
        assertTrue(runCatching { client.patchAdmitted(ApiRoute.PROFILE, TOKEN, "{}", gate) }.exceptionOrNull() is CancellationException)
        assertEquals(0, requests); client.close()
    }
    @Test fun mediaCommandRoundtripRetainsImmutableEnvelopeAndCannotMixText() {
        val photo = MediaContent.Attachment(MediaKind.PHOTO, listOf(MediaReceipt(OWN, MediaStatus.ready)))
        val command = TextCommand(CONVERSATION_ID, SCOPE_M, "PRIVATE", ACTOR_ID, MESSAGE_ID, "", photo)
        val body = StrictAuthJson.objectValue(command.body())
        assertEquals(photo.json(), body["content"])
        assertEquals(photo.json(), storedMedia(photo.json().toString()).json())
        assertThrows(IllegalArgumentException::class.java) { command.copy(text = "caption") }
        assertThrows(IllegalArgumentException::class.java) { MediaContent.Attachment(MediaKind.VIDEO, listOf(MediaReceipt(OWN, MediaStatus.processing))) }
        assertFalse(command.toString().contains(OWN))
    }
    @Test fun pushInstallationSurvivesReopenAndRefusesEnvironmentOrCiphertextTamperWithoutRegeneration() = runTest {
        val key = KeyGenerator.getInstance("AES").apply { init(256) }.generateKey()
        val disk = object : CredentialDisk {
            var bytes: ByteArray? = null
            override fun read() = bytes
            override fun write(value: ByteArray) { bytes = value }
            override fun isCleared() = false
            override fun markCleared() = Unit
            override fun removeClearMarker() = Unit
            override fun erase() { bytes = null }
        }
        val first = ProtectedPushInstallation(disk, "qa", { key }).readOrCreate()
        val cold = ProtectedPushInstallation(disk, "qa", { key }).readOrCreate()
        assertEquals(first.installationId, cold.installationId); assertEquals(first.bindingSecret, cold.bindingSecret)
        val bytes = requireNotNull(disk.bytes).copyOf()
        assertFalse(bytes.toString(Charsets.ISO_8859_1).contains(first.bindingSecret))
        assertTrue(runCatching { ProtectedPushInstallation(disk, "prod", { key }).readOrCreate() }.exceptionOrNull() is CredentialStoreException)
        assertArrayEquals(bytes, disk.bytes)
        disk.bytes!![20] = (disk.bytes!![20].toInt() xor 1).toByte()
        assertTrue(runCatching { ProtectedPushInstallation(disk, "qa", { key }).readOrCreate() }.exceptionOrNull() is CredentialStoreException)
    }
}
