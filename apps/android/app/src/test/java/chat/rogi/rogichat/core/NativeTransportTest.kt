package chat.rogi.rogichat.core

import chat.rogi.rogichat.core.network.*
import chat.rogi.rogichat.core.navigation.ShellAccess
import chat.rogi.rogichat.core.session.*
import chat.rogi.rogichat.feature.settings.*
import io.ktor.client.engine.mock.*
import io.ktor.http.*
import java.time.Clock
import java.time.Instant
import java.time.ZoneOffset
import java.time.ZoneId
import javax.crypto.KeyGenerator
import kotlinx.coroutines.*
import kotlinx.coroutines.test.runTest
import kotlinx.coroutines.test.advanceTimeBy
import kotlinx.coroutines.test.runCurrent
import org.junit.Assert.*
import org.junit.Test

internal const val OWN = "00000000-0000-4000-8000-000000000001"
internal const val OTHER = "00000000-0000-4000-8000-000000000002"
internal val NOW = Instant.parse("2026-09-20T00:00:00Z")
internal val EXPIRY = NOW.plusSeconds(604800)
internal val TOKEN = "a".repeat(43)
internal fun projection(linked: Boolean = true, generation: String = "g".repeat(43), expiry: Instant = EXPIRY) = """
    {"authenticated":true,"account":{"userId":"$OWN","nickname":"로기","avatarAssetId":null},
    "soopLinkStatus":"${if (linked) "VERIFIED" else "REQUIRED"}",
    "onboardingState":"${if (linked) "READY" else "SOOP_LINK_REQUIRED"}","expiresAt":"$expiry",
    "accountGeneration":"$generation","capabilities":{"chat":$linked}}
""".trimIndent()
internal fun profile(id: String = OWN, nickname: String = "로기") = """{"id":"$id","nickname":"$nickname","avatar":null,"birthday":null,"birthdayVisibleToStreamers":false}"""
internal class TestStore(var value: NativeCredential? = NativeCredential(TOKEN, EXPIRY)) : CredentialStore {
    var readFailure = false
    var clearFailure = false
    var writes = 0
    var clears = 0
    var beforeClear: suspend () -> Unit = {}
    override suspend fun read(): NativeCredential? { if (readFailure) throw CredentialStoreException(); return value }
    override suspend fun write(credential: NativeCredential) { writes++; value = credential }
    override suspend fun clear() { beforeClear(); clears++; if (clearFailure) throw CredentialStoreException(); value = null }
}
internal class TestApi : NativeApi {
    var gets = 0
    var getBlock: suspend (ApiRoute) -> String = { if (it == ApiRoute.SESSION) projection() else profile() }
    var patchBlock: suspend (String) -> String = { profile(nickname = "수정한 이름") }
    var postBlock: suspend () -> Unit = {}
    override suspend fun get(route: ApiRoute, token: String): String { gets++; assertEquals(TOKEN, token); return getBlock(route) }
    override suspend fun patch(route: ApiRoute, token: String, body: String): String { assertEquals(ApiRoute.PROFILE, route); return patchBlock(body) }
    override suspend fun postWithoutResponse(route: ApiRoute, token: String, body: String) { assertEquals(ApiRoute.LOGOUT, route); assertEquals("{}", body); postBlock() }
}

class NativeTransportTest {
    private fun gateway(store: TestStore = TestStore(), api: TestApi = TestApi()) = NativeSessionCoordinator(store, api, Clock.fixed(NOW, ZoneOffset.UTC))
    @Test fun explicitProjectionRejectsWebAndInconsistentRestrictedSession() {
        assertThrows(InvalidResponse::class.java) { NativeDtos.session("""{"authenticated":true,"csrfToken":"web"}""") }
        assertThrows(InvalidResponse::class.java) { NativeDtos.session(projection().replace("\"chat\":true", "\"chat\":false")) }
        assertThrows(InvalidResponse::class.java) { NativeDtos.session(projection().replace(OWN, "not-a-uuid")) }
        assertThrows(InvalidResponse::class.java) { NativeDtos.session(projection().replace("로기", " 로기 ")) }
        val restricted = NativeDtos.session(projection(linked = false))
        assertEquals(ShellAccess.LINK_REQUIRED, restricted.access)
        assertNull(restricted.account.signInMethod)
    }
    @Test fun realReviewerEntitlementRestoresWithoutClaimingSoopIdentity() = runTest {
        val entitled = projection().replace("VERIFIED", "REQUIRED")
        val api = TestApi().apply { getBlock = { entitled } }
        val model = gateway(api = api)
        assertTrue(model.restore().isSuccess)
        assertEquals(ShellAccess.READY, model.session.value.access)
        assertFalse(requireNotNull(model.session.value.account).soopConnected)
        api.getBlock = { projection(linked = false) }
        assertTrue(model.revalidate().isSuccess)
        assertEquals(ShellAccess.LINK_REQUIRED, model.session.value.access)
        for (body in listOf(
            entitled.replace("\"chat\":true", "\"chat\":false"),
            entitled.replace("READY", "SOOP_LINK_REQUIRED"),
            entitled.replace("REQUIRED", "UNKNOWN")
        )) assertThrows(InvalidResponse::class.java) { NativeDtos.session(body) }
    }
    @Test fun profileDecoderAndPatchPreserveClearVersusOmitted() {
        assertThrows(InvalidResponse::class.java) { NativeDtos.profile(profile().replace("\"birthday\":null", "\"birthday\":{\"month\":2,\"day\":30}")) }
        assertThrows(InvalidResponse::class.java) { NativeDtos.profile(profile(nickname = "\\ud800")) }
        assertEquals("{\"nickname\":\"이름\"}", NativeDtos.profilePatch(ProfileChanges("이름", FieldChange.Unchanged, null)))
        assertEquals("{\"birthday\":null,\"birthdayVisibleToStreamers\":false}", NativeDtos.profilePatch(ProfileChanges(null, FieldChange.Set(null), false)))
        assertThrows(IllegalArgumentException::class.java) { NativeDtos.profilePatch(ProfileChanges(null, FieldChange.Unchanged, null)) }
    }
    @Test fun missingCredentialNeverCallsNetworkOrInventsAccount() = runTest {
        val api = TestApi(); val model = gateway(TestStore(null), api)
        assertTrue(model.restore().isSuccess)
        assertEquals(ShellAccess.SIGNED_OUT, model.session.value.access)
        assertEquals(0, api.gets)
        assertTrue(model.providers.isEmpty()); assertFalse(model.canLinkSoop)
    }
    @Test fun selfProviderProfileIsAdditiveAndCannotReplaceAccountIdentity() {
        val previous = NativeDtos.profile(profile())
        assertNull(previous.soopDisplayId); assertNull(previous.providerAvatarUrl)
        val body = profile(nickname = "직접 바꾼 이름").dropLast(1) + """, "soop":{"displayId":"provider_id"}, "providerAvatarUrl":"https://profile.img.sooplive.co.kr/LOGO/pr/provider_id/provider_id.jpg"}"""
        val imported = NativeDtos.profile(body)
        assertEquals(OWN, imported.id); assertEquals("직접 바꾼 이름", imported.nickname)
        assertEquals("provider_id", imported.soopDisplayId); assertNotNull(imported.providerAvatarUrl)
        val cleared = NativeDtos.profile(profile().dropLast(1) + """, "soop":null, "providerAvatarUrl":null}""")
        assertNull(cleared.soopDisplayId); assertNull(cleared.providerAvatarUrl)
        assertThrows(InvalidResponse::class.java) { NativeDtos.profile(body.replace("https://", "http://")) }
        assertThrows(InvalidResponse::class.java) { NativeDtos.profile(body.replace("\"displayId\":\"provider_id\"", "\"displayId\":5")) }
        assertEquals("{\"nickname\":\"수정\"}", NativeDtos.profilePatch(ProfileChanges("수정", FieldChange.Unchanged, null)))
    }
    @Test fun protectedReadFailureRemainsRetryableAndDoesNotMasqueradeAsMissing() = runTest {
        val store = TestStore().apply { readFailure = true }; val model = gateway(store)
        assertTrue(model.restore().isFailure)
        assertEquals(ShellAccess.RETRYABLE_FAILURE, model.session.value.access)
        assertEquals(0, store.clears)
        store.readFailure = false
        assertTrue(model.restore().isSuccess)
        assertEquals(ShellAccess.READY, model.session.value.access)
    }
    @Test fun expiredCredentialIsRemovedWithoutRefreshEndpoint() = runTest {
        val store = TestStore(NativeCredential(TOKEN, NOW)); val api = TestApi(); val model = gateway(store, api)
        model.restore()
        assertNull(store.value); assertEquals(0, api.gets); assertEquals(ShellAccess.SIGNED_OUT, model.session.value.access)
    }
    @Test fun idleForegroundSessionExpiresLocallyAndStaleExpiryCannotClearNewScope() = runTest {
        val clock = object : Clock() {
            override fun getZone(): ZoneId = ZoneOffset.UTC
            override fun withZone(zone: ZoneId): Clock = this
            override fun instant(): Instant = NOW.plusMillis(testScheduler.currentTime)
        }
        val expiry = NOW.plusSeconds(60)
        val store = TestStore(NativeCredential(TOKEN, expiry))
        val api = TestApi().apply { getBlock = { projection(expiry = expiry) } }
        val model = NativeSessionCoordinator(store, api, clock)
        model.restore()
        val oldGeneration = model.session.value.generation
        val ui = SessionViewModel(model.services(), backgroundScope, clock)
        ui.start(); runCurrent()
        advanceTimeBy(30_000); runCurrent()
        api.getBlock = { projection(expiry = expiry, generation = "h".repeat(43)) }
        model.revalidate(); runCurrent()
        assertTrue(model.session.value.generation > oldGeneration)
        advanceTimeBy(30_000)
        model.expireSession(oldGeneration, expiry)
        assertEquals(ShellAccess.READY, model.session.value.access)
        runCurrent()
        assertEquals(ShellAccess.SIGNED_OUT, model.session.value.access)
        assertNull(model.session.value.account); assertNull(store.value)
        assertEquals(2, api.gets) // Restore + revalidation only; expiry does not call the network.
        assertEquals(1, store.clears)
    }
    @Test fun authoritative401ClearsCurrentCredentialBut503KeepsItForRetry() = runTest {
        val store = TestStore(); val api = TestApi(); val model = gateway(store, api)
        api.getBlock = { throw ApiException(503, "AUTH_UNAVAILABLE") }
        model.restore(); assertNotNull(store.value); assertEquals(ShellAccess.RETRYABLE_FAILURE, model.session.value.access)
        api.getBlock = { throw ApiException(401, "UNAUTHENTICATED") }
        model.restore(); assertNull(store.value); assertEquals(ShellAccess.SIGNED_OUT, model.session.value.access)
    }
    @Test fun changedFixedExpiryFailsWithoutExtendingStoredCredential() = runTest {
        val store = TestStore(); val api = TestApi().apply { getBlock = { projection(expiry = EXPIRY.plusSeconds(1)) } }
        val model = gateway(store, api); assertTrue(model.restore().isFailure)
        assertEquals(EXPIRY, store.value!!.expiresAt); assertEquals(0, store.writes)
        assertEquals(ShellAccess.RETRYABLE_FAILURE, model.session.value.access)
    }
    @Test fun sameAccountServerGenerationChangesLocalEpochAndUnchangedRefreshDoesNot() = runTest {
        val api = TestApi(); val model = gateway(api = api)
        model.restore(); val initial = model.session.value.generation
        model.revalidate(); assertEquals(initial, model.session.value.generation)
        api.getBlock = { projection(generation = "h".repeat(43)) }
        model.revalidate(); assertTrue(model.session.value.generation > initial)
    }
    @Test fun lateRestorationAfterLogoutCannotWriteOrResurrectAccount() = runTest {
        val response = CompletableDeferred<String>(); val api = TestApi().apply { getBlock = { response.await() } }
        val store = TestStore(); val model = gateway(store, api)
        val job = launch { model.restore() }; yield()
        model.signOut(); response.complete(projection()); job.join()
        assertNull(store.value); assertEquals(0, store.writes); assertEquals(ShellAccess.SIGNED_OUT, model.session.value.access)
    }
    @Test fun cancelledRestoreReleasesSingleFlightForRetry() = runTest {
        val response = CompletableDeferred<String>(); val api = TestApi().apply { getBlock = { response.await() } }
        val model = gateway(api = api); val job = launch { model.restore() }; yield(); job.cancelAndJoin()
        api.getBlock = { projection() }
        assertTrue(model.restore().isSuccess); assertEquals(ShellAccess.READY, model.session.value.access)
    }
    @Test fun logoutClearCannotBeCancelledBeforeDurableRemoval() = runTest {
        val entered = CompletableDeferred<Unit>(); val release = CompletableDeferred<Unit>()
        val store = TestStore(); val model = gateway(store); model.restore()
        store.beforeClear = { entered.complete(Unit); release.await() }
        val logout = launch { model.signOut() }; entered.await(); logout.cancel(); release.complete(Unit); logout.join()
        assertNull(store.value); assertNull(model.session.value.account); assertEquals(ShellAccess.SIGNED_OUT, model.session.value.access)
    }
    @Test fun failedClearHidesPrivateStateAndRetryRemovesBeforeRestore() = runTest {
        val store = TestStore(); val model = gateway(store); model.restore(); store.clearFailure = true
        assertTrue(model.signOut().isFailure); assertNull(model.session.value.account)
        assertEquals(ShellAccess.RETRYABLE_FAILURE, model.session.value.access)
        store.clearFailure = false; model.restore(); assertNull(store.value); assertEquals(ShellAccess.SIGNED_OUT, model.session.value.access)
    }
    @Test fun offlineLogoutIsLocalWithTruthfulRemoteNotice() = runTest {
        val store = TestStore(); val api = TestApi().apply { postBlock = { throw ApiException(503, "UNAVAILABLE") } }
        val model = gateway(store, api); model.restore(); model.signOut()
        assertNull(store.value); assertEquals(ShellAccess.SIGNED_OUT, model.session.value.access)
        assertTrue(model.session.value.notice!!.contains("확인하지 못했어요"))
    }
    @Test fun fullProfileIsFetchedForRestrictedAccountAndSaveUpdatesSummaryWithoutEpochReset() = runTest {
        val api = TestApi().apply { getBlock = { if (it == ApiRoute.SESSION) projection(linked = false) else profile() } }
        val model = gateway(api = api); model.restore(); val epoch = model.session.value.generation
        assertEquals(OWN, model.load(OWN).getOrThrow().id)
        model.save(OWN, ProfileChanges("수정한 이름", FieldChange.Unchanged, null)).getOrThrow()
        assertEquals("수정한 이름", model.session.value.account!!.nickname)
        assertEquals(epoch, model.session.value.generation)
    }
    @Test fun lateProfileSaveAfterLogoutIsCancelledAndCannotPublishPrivateData() = runTest {
        val response = CompletableDeferred<String>(); val api = TestApi().apply { patchBlock = { response.await() } }
        val model = gateway(api = api); model.restore()
        val save = async { model.save(OWN, ProfileChanges("이름", FieldChange.Unchanged, null)) }; yield()
        model.signOut(); response.complete(profile(nickname = "이름"))
        try { save.await(); fail("late save must cancel") } catch (_: CancellationException) { }
        assertNull(model.session.value.account)
    }
    @Test fun profileCompletionAfterFixedExpiryIsDiscardedAndCredentialCleared() = runTest {
        val clock = object : Clock() {
            var time = NOW
            override fun instant() = time
            override fun getZone(): ZoneId = ZoneOffset.UTC
            override fun withZone(zone: ZoneId): Clock = this
        }
        val store = TestStore(); val api = TestApi(); val model = NativeSessionCoordinator(store, api, clock)
        model.restore()
        val response = CompletableDeferred<String>(); api.patchBlock = { response.await() }
        val save = async { model.save(OWN, ProfileChanges("수정한 이름", FieldChange.Unchanged, null)) }; yield()
        clock.time = EXPIRY
        response.complete(profile(nickname = "수정한 이름"))
        try { save.await(); fail("expired result") } catch (_: CancellationException) { }
        assertEquals(ShellAccess.SIGNED_OUT, model.session.value.access)
        assertNull(model.session.value.account); assertNull(store.value)
    }
    @Test fun oldSessionResponseDoesNotOverwriteConfirmedProfileSaveButAppliesAuthorization() = runTest {
        val api = TestApi(); val model = gateway(api = api); model.restore()
        val response = CompletableDeferred<String>(); api.getBlock = { response.await() }
        val revalidation = launch { model.revalidate() }; yield()
        model.save(OWN, ProfileChanges("수정한 이름", FieldChange.Unchanged, null)).getOrThrow()
        response.complete(projection(linked = false, generation = "z".repeat(43))); revalidation.join()
        assertEquals("수정한 이름", model.session.value.account!!.nickname)
        assertEquals(ShellAccess.LINK_REQUIRED, model.session.value.access)
        assertFalse(model.session.value.account!!.soopConnected)
    }
    @Test fun backgroundNetworkFailureKeepsUnexpiredAccountScopeAndVisibleRetryThen401Clears() = runTest {
        val api = TestApi(); val store = TestStore(); val model = gateway(store, api); model.restore()
        val before = model.session.value
        api.getBlock = { throw ApiException(503, "AUTH_UNAVAILABLE") }
        assertTrue(model.revalidate().isFailure)
        assertEquals(before.generation, model.session.value.generation)
        assertEquals(before.account, model.session.value.account)
        assertTrue(model.session.value.validationNeedsRetry)
        assertNotNull(model.session.value.notice)
        api.getBlock = { projection() }; model.revalidate()
        assertFalse(model.session.value.validationNeedsRetry); assertNull(model.session.value.notice)
        api.getBlock = { throw ApiException(401, "UNAUTHENTICATED") }; model.revalidate()
        assertNull(model.session.value.account); assertNull(store.value)
    }
    @Test fun wrongAccountProfileAndOrdinary403DoNotReplaceOrDeleteCurrentAccount() = runTest {
        val store = TestStore(); val api = TestApi(); val model = gateway(store, api); model.restore()
        api.getBlock = { profile(OTHER) }; assertTrue(model.load(OWN).isFailure)
        api.getBlock = { throw ApiException(403, "FORBIDDEN") }; assertTrue(model.load(OWN).isFailure)
        assertNotNull(store.value); assertEquals(OWN, model.session.value.account!!.id)
    }
    @Test fun nativeHeadersNoCookiesOriginCsrfOrRedirectAndNoAutomatic401Replay() = runTest {
        var calls = 0
        val engine = MockEngine { request ->
            calls++
            assertEquals("https://api.qa.rogi.chat/v1/auth/session", request.url.toString())
            assertEquals(listOf("Bearer $TOKEN"), request.headers.getAll("Authorization"))
            assertEquals("android", request.headers["X-Rogi-Client"])
            listOf("Cookie", "Origin", "X-CSRF-Token").forEach { assertNull(request.headers[it]) }
            respond("", HttpStatusCode.Found, headersOf("Location", "https://example.invalid/token"))
        }
        val client = ApiClient("https://api.qa.rogi.chat/v1/", engine)
        try { client.get(ApiRoute.SESSION, TOKEN); fail("redirect must fail") } catch (error: ApiException) { assertEquals(302, error.statusCode) }
        assertEquals(1, calls); client.close()
        val unauthorized = MockEngine { calls++; respond("""{"error":{"code":"UNAUTHENTICATED"}}""", HttpStatusCode.Unauthorized) }
        val second = ApiClient("https://api.qa.rogi.chat/v1/", unauthorized)
        try { second.get(ApiRoute.SESSION, TOKEN); fail("401 must fail") } catch (error: ApiException) { assertEquals("UNAUTHENTICATED", error.code) }
        assertEquals(2, calls); second.close()
    }
    @Test fun credentialEnvelopeIsAuthenticatedEnvironmentBoundAndNeverPlaintext() = runTest {
        val key = KeyGenerator.getInstance("AES").apply { init(256) }.generateKey()
        val cipher = CredentialCipher("qa") { key }; val original = NativeCredential(TOKEN, EXPIRY)
        val encrypted = cipher.seal(original)
        assertFalse(encrypted.toString(Charsets.ISO_8859_1).contains(TOKEN))
        assertEquals(TOKEN, cipher.open(encrypted).token); assertEquals(EXPIRY, cipher.open(encrypted).expiresAt)
        assertThrows(Exception::class.java) { CredentialCipher("prod") { key }.open(encrypted) }
        assertThrows(Exception::class.java) { cipher.open(encrypted.copyOf().also { it[15] = (it[15].toInt() xor 1).toByte() }) }
        assertFalse(original.toString().contains(TOKEN))
    }
    @Test fun oversizedHttpResponseAndArbitraryBaseUrlAreRejected() = runTest {
        val engine = MockEngine { respond("x".repeat(1_048_577), HttpStatusCode.OK) }
        assertThrows(IllegalArgumentException::class.java) { ApiClient("https://example.invalid/v1/", engine) }
        val client = ApiClient("https://api.qa.rogi.chat/v1/", engine)
        try { client.get(ApiRoute.SESSION, TOKEN); fail("oversized response") } catch (_: InvalidResponse) { }
        client.close()
    }
    @Test fun persistentClearMarkerPreventsResurrectionAfterFailedEraseAndNewStoreInstance() = runTest {
        val key = KeyGenerator.getInstance("AES").apply { init(256) }.generateKey()
        val cipher = CredentialCipher("qa") { key }
        val disk = object : CredentialDisk {
            var bytes: ByteArray? = null; var marker = false; var eraseFailure = true
            override fun read() = bytes
            override fun write(value: ByteArray) { bytes = value }
            override fun isCleared() = marker
            override fun markCleared() { marker = true }
            override fun removeClearMarker() { marker = false }
            override fun erase() { if (eraseFailure) error("disk failure"); bytes = null }
        }
        val first = ProtectedCredentialStore(disk, cipher, Dispatchers.Unconfined)
        first.write(NativeCredential(TOKEN, EXPIRY))
        try { first.clear(); fail("erase should fail") } catch (_: CredentialStoreException) { }
        assertNotNull(disk.bytes)
        val reopened = ProtectedCredentialStore(disk, cipher, Dispatchers.Unconfined)
        try { reopened.read(); fail("pending erase must retry and report storage failure") } catch (_: CredentialStoreException) { }
        disk.eraseFailure = false
        assertNull(reopened.read()); assertNull(disk.bytes)
    }
}
