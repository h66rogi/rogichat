package chat.rogi.rogichat.core

import chat.rogi.rogichat.core.auth.*
import chat.rogi.rogichat.core.network.*
import chat.rogi.rogichat.core.session.*
import chat.rogi.rogichat.core.navigation.ShellAccess
import io.ktor.client.engine.mock.*
import io.ktor.http.*
import java.time.Clock
import java.time.Instant
import java.time.ZoneId
import java.time.ZoneOffset
import java.io.IOException
import javax.crypto.KeyGenerator
import kotlinx.coroutines.*
import kotlinx.coroutines.test.runTest
import kotlinx.serialization.json.*
import org.junit.Assert.*
import org.junit.Test

private val NEW_TOKEN = "n".repeat(43)
private val CODE = "c".repeat(43)
private const val TRANSACTION = "00000000-0000-4000-8000-000000000007"
private fun startResponse() = """{"transactionId":"$TRANSACTION","authorizeUrl":"https://api.qa.rogi.chat/v1/auth/native/soop/launch?request=${"r".repeat(43)}","expiresIn":600}"""
private fun exchangeResponse(token: String = NEW_TOKEN, account: String = OWN) = """{"tokenType":"Bearer","accessToken":"$token","expiresAt":"$EXPIRY","session":${projection().replace(OWN, account)}}"""
private fun callback(state: String, code: String = CODE) = "https://qa.rogi.chat/mobile/auth/complete?code=$code&state=$state"
private class AuthClock(var now: Instant = NOW) : Clock() {
    override fun getZone(): ZoneId = ZoneOffset.UTC
    override fun withZone(zone: ZoneId): Clock = this
    override fun instant(): Instant = now
}
private class AuthStore(var value: NativeCredential? = null) : CredentialStore {
    var stamp: String? = null
    var clears = 0
    var writes = 0
    var failRead = false
    var failWriteAfterMutation = false
    var beforeWrite: suspend () -> Unit = {}
    override suspend fun read(): NativeCredential? { if (failRead) throw CredentialStoreException(); return value }
    override suspend fun write(credential: NativeCredential) {
        beforeWrite(); value = credential; writes++; stamp = null
        if (failWriteAfterMutation) throw CredentialStoreException()
    }
    override suspend fun clear() { value = null; stamp = fingerprint("clear-${++clears}"); failRead = false }
    override suspend fun clearStamp() = stamp
}
private class AuthPendingStore : PendingAuthStore {
    var value: PendingAuth? = null
    var marked = false
    var failErase = false
    var failMarker = false
    var writes = 0
    override suspend fun read(): PendingAuth? {
        if (marked) { if (failErase) throw CredentialStoreException(); value = null }
        return value
    }
    override suspend fun write(value: PendingAuth) { this.value = value; marked = false; writes++ }
    override suspend fun clear() {
        if (failMarker) throw CredentialStoreException()
        marked = true
        if (failErase) throw CredentialStoreException()
        value = null
    }
}
private class AuthApi : NativeApi {
    var requests = mutableListOf<Triple<ApiRoute, String?, String>>()
    val revoked = mutableListOf<String>()
    var startBlock: suspend () -> String = { startResponse() }
    var exchangeBlock: suspend () -> String = { exchangeResponse() }
    var sessionCalls = 0
    var sessionBlock: suspend () -> String = { projection(linked = false) }
    override suspend fun postAuth(route: ApiRoute, token: String?, body: String): String {
        requests.add(Triple(route, token, body))
        return when (route) { ApiRoute.SOOP_START -> startBlock(); ApiRoute.SOOP_EXCHANGE -> exchangeBlock(); else -> error("unexpected") }
    }
    override suspend fun get(route: ApiRoute, token: String): String { sessionCalls++; return sessionBlock() }
    override suspend fun patch(route: ApiRoute, token: String, body: String): String = error("unexpected")
    override suspend fun postWithoutResponse(route: ApiRoute, token: String, body: String) { assertEquals(ApiRoute.LOGOUT, route); revoked.add(token) }
}
private class AuthFixture(val store: AuthStore = AuthStore(), val pending: AuthPendingStore = AuthPendingStore(),
                          val api: AuthApi = AuthApi(), val clock: AuthClock = AuthClock(),
                          val rooms: chat.rogi.rogichat.core.rooms.RoomsStore? = null) {
    var proofs = 0
    val model = coordinator()
    fun coordinator() = NativeSessionCoordinator(store, api, clock, SoopAuthSupport(SoopAuthContract("qa"), pending) {
        val ordinal = ++proofs
        AuthProof(fingerprint("verifier-$ordinal"), fingerprint("state-$ordinal"))
    }, rooms)
    suspend fun login(): String {
        model.restore(); assertTrue(model.startLogin(CURRENT_TERMS).isSuccess)
        return requireNotNull(pending.value).proof.state
    }
    suspend fun link(): String {
        model.restore(); assertTrue(model.linkSoop().isSuccess)
        return requireNotNull(pending.value).proof.state
    }
}

class NativeSoopAuthTest {
    @Test fun roomsPurgeFailureBeforeCredentialInstallEndsAuthAndRevokesOnlyNewToken() = runTest {
        val db = RoomTestStore(); val fixture = AuthFixture(rooms = db)
        val state = fixture.login(); db.failClear = true
        assertTrue(fixture.model.handleCallback(callback(state)).isFailure)
        assertNull(fixture.store.value)
        assertFalse(fixture.model.authState.value.active)
        assertEquals(AuthProblem.STORAGE, fixture.model.authState.value.error)
        assertEquals(ShellAccess.RETRYABLE_FAILURE, fixture.model.session.value.access)
        assertEquals(listOf(NEW_TOKEN), fixture.api.revoked)
        assertTrue(fixture.pending.marked)
    }
    @Test fun proofUsesIndependentRandom32ByteValuesAndS256() {
        val all = mutableSetOf<String>()
        repeat(20) {
            val proof = AuthProof.create()
            assertTrue(opaque(proof.verifier)); assertTrue(opaque(proof.state))
            assertTrue(all.add(proof.verifier)); assertTrue(all.add(proof.state))
            assertEquals(fingerprint(proof.verifier), proof.challenge)
            assertFalse(proof.toString().contains(proof.verifier))
        }
    }
    @Test fun callbackAndAuthorizeRejectHostPathPortFragmentDuplicateAndUnknownFields() {
        val contract = SoopAuthContract("qa"); val state = "s".repeat(43)
        assertEquals(CODE, contract.callback(callback(state)).code)
        val invalid = listOf(callback(state).replace("qa.rogi.chat", "rogi.chat"), callback(state).replace("https:", "http:"),
            callback(state).replace("qa.rogi.chat", "qa.rogi.chat:443"), callback(state)+"#fragment", callback(state)+"&state=$state",
            callback(state)+"&intent=login", callback(state).replace("/complete", "/complete/"), callback(state).replace("state=", "%73tate="),
            callback(state).replace("qa.rogi.chat", "user@qa.rogi.chat"), callback(state)+"&error=AUTH_UNAVAILABLE")
        invalid.forEach { assertThrows(Exception::class.java) { contract.callback(it) } }
        assertThrows(Exception::class.java) { contract.callback("https://qa.rogi.chat/mobile/auth/complete?state=$state&error=provider_private_message") }
        assertThrows(Exception::class.java) { contract.authorize("https://api.rogi.chat/v1/auth/native/soop/launch?request=$state") }
        assertThrows(Exception::class.java) { contract.authorize("https://api.qa.rogi.chat/v1/auth/native/soop/launch?request=$state&returnUrl=evil") }
        assertEquals(state, contract.callback("https://qa.rogi.chat/mobile/auth/complete?error=TERMS_REQUIRED&state=$state").state)
    }
    @Test fun responseParserRejectsExtraDuplicateEscapedKeysAndMismatchedExpiry() {
        val contract = SoopAuthContract("qa")
        assertEquals(TRANSACTION, contract.start(startResponse()).transactionId)
        assertThrows(InvalidResponse::class.java) { contract.start(startResponse().replace("\"expiresIn\":600", "\"expiresIn\":600,\"expiresIn\":600")) }
        assertThrows(InvalidResponse::class.java) { contract.start(startResponse().replace("\"expiresIn\":600", "\"expiresIn\":600,\"expires\\u0049n\":600")) }
        assertThrows(InvalidResponse::class.java) { contract.start(startResponse().replace("\"expiresIn\":600", "\"expiresIn\":600,\"verifier\":\"bad\"")) }
        assertThrows(InvalidResponse::class.java) { contract.exchange(exchangeResponse().replaceFirst(EXPIRY.toString(), EXPIRY.plusSeconds(1).toString())) }
        assertEquals(ShellAccess.READY, contract.exchange(exchangeResponse().replace("\"chat\":true", "\"chat\":true,\"futureCapability\":true")).session.access)
        assertEquals(NEW_TOKEN, contract.exchange(exchangeResponse()).credential.token)
        assertThrows(InvalidResponse::class.java) { contract.exchange(exchangeResponse().replace("\"chat\":true", "\"chat\":true,\"deep\":" + "[".repeat(40) + "0" + "]".repeat(40))) }
    }
    @Test fun loginRequiresExplicitTermsAndOmitsBearerAtBothStages() = runTest {
        val f = AuthFixture(); f.model.restore()
        assertTrue(f.model.startLogin("old").isFailure); assertTrue(f.api.requests.isEmpty())
        val state = f.login()
        val start = Json.parseToJsonElement(f.api.requests.single().third).jsonObject
        assertEquals(setOf("clientId", "intent", "codeChallenge", "codeChallengeMethod", "returnState", "termsVersion"), start.keys)
        assertEquals("android", start.getValue("clientId").jsonPrimitive.content)
        assertEquals("login", start.getValue("intent").jsonPrimitive.content)
        assertEquals(CURRENT_TERMS, start.getValue("termsVersion").jsonPrimitive.content)
        assertEquals(ShellAccess.SIGNED_OUT, f.model.session.value.access) // Browser handoff is not successful login.
        assertTrue(f.model.handleCallback(callback(state)).isSuccess)
        assertTrue(f.api.requests.all { it.second == null })
        assertEquals(NEW_TOKEN, f.store.value!!.token); assertEquals(ShellAccess.READY, f.model.session.value.access)
        assertEquals(AuthPhase.IDLE, f.model.authState.value.phase)
    }
    @Test fun browserLaunchIsOneShotAndExpiredLaunchNeverOpens() = runTest {
        val f = AuthFixture(); val state = f.login()
        assertNotNull(f.model.claimBrowserLaunch(state)); assertNull(f.model.claimBrowserLaunch(state))
        f.model.cancelAuthentication(); val next = f.login(); f.clock.now = NOW.plusSeconds(60)
        assertNull(f.model.claimBrowserLaunch(next)); assertEquals(AuthProblem.EXPIRED, f.model.authState.value.error)
    }
    @Test fun slowStartExpiresBeforePublishingBrowserAndOverallTimeoutErasesProof() = runTest {
        val f = AuthFixture(); f.api.startBlock = { f.clock.now = NOW.plusSeconds(61); startResponse() }
        f.model.restore(); f.model.startLogin(CURRENT_TERMS)
        assertNull(f.pending.value); assertNull(f.model.browserLaunch.value)
        val g = AuthFixture(); val state = g.login(); g.clock.now = NOW.plusSeconds(600)
        g.model.handleCallback(callback(state)); assertEquals(1, g.api.requests.size)
        assertTrue(g.pending.marked); assertEquals(AuthProblem.EXPIRED, g.model.authState.value.error)
    }
    @Test fun wrongStateAndMalformedCallbackDoNotConsumeRightfulPending() = runTest {
        val f = AuthFixture(); val state = f.login(); val original = f.pending.value
        f.model.handleCallback(callback("w".repeat(43))); f.model.handleCallback(callback(state)+"&extra=value")
        assertSame(original, f.pending.value); assertEquals(1, f.api.requests.size)
        f.model.handleCallback(callback(state)); assertEquals(2, f.api.requests.size)
    }
    @Test fun duplicateCompletionAndColdConsumedProofNeverExchangeAgain() = runTest {
        val f = AuthFixture(); val state = f.login(); f.model.handleCallback(callback(state))
        f.model.handleCallback(callback(state)); assertEquals(2, f.api.requests.size)
        val cold = f.coordinator(); f.api.sessionBlock = { projection() }; cold.restore()
        cold.handleCallback(callback(state)); assertEquals(2, f.api.requests.size)
    }
    @Test fun processDeathBeforeCallbackRestoresEncryptedProofAndLoginScope() = runTest {
        val f = AuthFixture(); val state = f.login(); val cold = f.coordinator()
        assertTrue(cold.handleCallback(callback(state)).isSuccess)
        assertEquals(ShellAccess.READY, cold.session.value.access); assertEquals(NEW_TOKEN, f.store.value?.token)
    }
    @Test fun linkUsesSameOriginalBearerAndCannotReplaceDifferentAccount() = runTest {
        val f = AuthFixture(AuthStore(NativeCredential(TOKEN, EXPIRY))); val state = f.link()
        val start = Json.parseToJsonElement(f.api.requests.single().third).jsonObject
        assertEquals("link", start.getValue("intent").jsonPrimitive.content); assertFalse(start.containsKey("termsVersion"))
        f.api.exchangeBlock = { exchangeResponse(account = OTHER) }
        assertTrue(f.model.handleCallback(callback(state)).isFailure)
        assertTrue(f.api.requests.all { it.second == TOKEN }); assertEquals(TOKEN, f.store.value?.token)
        assertEquals(OWN, f.model.session.value.account?.id); assertEquals(listOf(NEW_TOKEN), f.api.revoked)
    }
    @Test fun coldLinkRestoresOnlySameBearerAccountAndServerGeneration() = runTest {
        val f = AuthFixture(AuthStore(NativeCredential(TOKEN, EXPIRY))); val state = f.link()
        val cold = f.coordinator(); assertTrue(cold.handleCallback(callback(state)).isSuccess)
        assertEquals(NEW_TOKEN, f.store.value?.token); assertEquals(OWN, cold.session.value.account?.id)
        val g = AuthFixture(AuthStore(NativeCredential(TOKEN, EXPIRY))); val old = g.link()
        g.api.sessionBlock = { projection(linked = false, generation = "h".repeat(43)) }
        val changed = g.coordinator(); changed.handleCallback(callback(old))
        assertEquals(1, g.api.requests.size); assertEquals(TOKEN, g.store.value?.token)
        assertEquals(AuthProblem.SESSION_CHANGED, changed.authState.value.error)
    }
    @Test fun termsRecentAuthAndConflictPreserveCurrentAccountWithoutLoginConversion() = runTest {
        listOf("TERMS_REQUIRED" to 403, "RECENT_AUTH_REQUIRED" to 403, "SOOP_LINK_CONFLICT" to 409, "LINK_SESSION_CHANGED" to 401).forEach { (code, status) ->
            val f = AuthFixture(AuthStore(NativeCredential(TOKEN, EXPIRY))); val state = f.link()
            f.api.exchangeBlock = { throw ApiException(status, code) }
            f.model.handleCallback(callback(state))
            assertEquals(TOKEN, f.store.value?.token); assertEquals(OWN, f.model.session.value.account?.id)
            assertEquals(2, f.api.requests.size); assertTrue(f.api.requests.all { it.second == TOKEN })
            assertEquals(SoopAuthContract.problem(code, status), f.model.authState.value.error)
        }
    }
    @Test fun callbackErrorsConsumeMatchingFlowOnlyAndKeepLinkedAccount() = runTest {
        val f = AuthFixture(AuthStore(NativeCredential(TOKEN, EXPIRY))); val state = f.link()
        f.model.handleCallback("https://qa.rogi.chat/mobile/auth/complete?error=TERMS_REQUIRED&state=$state")
        assertEquals(AuthProblem.TERMS, f.model.authState.value.error); assertEquals(TOKEN, f.store.value?.token)
        assertTrue(f.pending.marked); assertEquals(1, f.api.requests.size)
    }
    @Test fun lostExchangeResponseRequiresFreshAuthAndNeverReplaysCode() = runTest {
        val f = AuthFixture(); val state = f.login(); f.api.exchangeBlock = { throw IOException("private-detail") }
        f.model.handleCallback(callback(state)); f.model.handleCallback(callback(state))
        val cold = f.coordinator(); cold.handleCallback(callback(state))
        assertEquals(2, f.api.requests.size); assertNull(f.store.value)
        assertEquals(AuthProblem.LOST_RESPONSE, f.model.authState.value.error)
        assertFalse(f.model.authState.value.toString().contains("private-detail"))
    }
    @Test fun cancelWhileStartAndReversedStartResponsesCannotOverwriteNewerProof() = runTest {
        val f = AuthFixture(); f.model.restore(); val first = CompletableDeferred<String>(); f.api.startBlock = { first.await() }
        val old = launch { f.model.startLogin(CURRENT_TERMS) }; yield()
        f.model.cancelAuthentication(); f.api.startBlock = { startResponse() }; f.model.startLogin(CURRENT_TERMS)
        val newer = requireNotNull(f.pending.value).proof.state
        first.complete(startResponse()); old.join()
        assertEquals(newer, f.pending.value?.proof?.state); assertEquals(1, f.pending.writes)
    }
    @Test fun cancelDuringExchangeRevokesOnlyReturnedNewCredential() = runTest {
        val f = AuthFixture(); val state = f.login(); val response = CompletableDeferred<String>(); f.api.exchangeBlock = { response.await() }
        val old = launch { f.model.handleCallback(callback(state)) }; yield()
        f.model.cancelAuthentication(); response.complete(exchangeResponse()); old.join()
        assertNull(f.store.value); assertEquals(listOf(NEW_TOKEN), f.api.revoked)
        assertEquals(ShellAccess.SIGNED_OUT, f.model.session.value.access)
    }
    @Test fun newerLoginWinsAndLatePriorLink401NeverClearsIt() = runTest {
        val f = AuthFixture(AuthStore(NativeCredential(TOKEN, EXPIRY))); val state = f.link()
        val response = CompletableDeferred<String>(); f.api.exchangeBlock = { response.await() }
        val old = launch { f.model.handleCallback(callback(state)) }; yield()
        f.model.signOut(); val next = f.login(); f.api.exchangeBlock = { exchangeResponse() }
        f.model.handleCallback(callback(next)); response.completeExceptionally(ApiException(401, "LINK_SESSION_CHANGED")); old.join()
        assertEquals(NEW_TOKEN, f.store.value?.token); assertEquals(ShellAccess.READY, f.model.session.value.access)
        assertEquals(listOf(TOKEN), f.api.revoked)
    }
    @Test fun twoLoginExchangesCompletingInReverseInstallOnlyNewerAndRevokeOldReturnedToken() = runTest {
        val f = AuthFixture(); val firstState = f.login(); val gate = CompletableDeferred<String>(); f.api.exchangeBlock = { gate.await() }
        val first = launch { f.model.handleCallback(callback(firstState)) }; yield()
        f.model.cancelAuthentication(); val newer = f.login(); f.api.exchangeBlock = { exchangeResponse(token = "z".repeat(43)) }
        f.model.handleCallback(callback(newer)); gate.complete(exchangeResponse()); first.join()
        assertEquals("z".repeat(43), f.store.value?.token); assertEquals(listOf(NEW_TOKEN), f.api.revoked)
    }
    @Test fun localCompletionDeadlineDiscardsDelayedResponseAndRevokesOnlyNewToken() = runTest {
        val f = AuthFixture(); val state = f.login()
        f.api.exchangeBlock = { f.clock.now = NOW.plusSeconds(121); exchangeResponse() }
        f.model.handleCallback(callback(state))
        assertNull(f.store.value); assertEquals(listOf(NEW_TOKEN), f.api.revoked)
    }
    @Test fun failedPendingErasePreventsExchangeAndTombstoneSurvivesProcessDeath() = runTest {
        val f = AuthFixture(); val state = f.login(); f.pending.failErase = true
        assertTrue(f.model.handleCallback(callback(state)).isFailure); assertEquals(1, f.api.requests.size)
        assertTrue(f.pending.marked); val cold = f.coordinator(); cold.handleCallback(callback(state))
        assertEquals(1, f.api.requests.size); assertNull(f.store.value)
    }
    @Test fun logoutCredentialStampRejectsOldLoginEvenIfPendingTombstoneWriteFailed() = runTest {
        val f = AuthFixture(); val state = f.login(); val oldPending = f.pending.value
        f.pending.failMarker = true; assertTrue(f.model.signOut().isFailure)
        assertNotNull(f.store.stamp); assertSame(oldPending, f.pending.value)
        f.pending.failMarker = false
        val cold = f.coordinator(); cold.handleCallback(callback(state))
        assertEquals(1, f.api.requests.size); assertNull(f.store.value); assertTrue(f.pending.marked)
    }
    @Test fun cancellationDuringAtomicInstallClearsDurableCredentialBeforePublishingAccount() = runTest {
        val f = AuthFixture(); val state = f.login(); val entered = CompletableDeferred<Unit>(); val release = CompletableDeferred<Unit>()
        f.store.beforeWrite = { entered.complete(Unit); release.await() }
        val job = launch { f.model.handleCallback(callback(state)) }
        entered.await(); job.cancel(); release.complete(Unit); job.join()
        assertNull(f.store.value); assertNull(f.model.session.value.account)
        assertEquals(listOf(NEW_TOKEN), f.api.revoked); assertEquals(ShellAccess.SIGNED_OUT, f.model.session.value.access)
    }
    @Test fun partialCredentialWriteFailureHidesAccountClearsBytesAndRevokesNewToken() = runTest {
        val f = AuthFixture(); val state = f.login(); f.store.failWriteAfterMutation = true
        assertTrue(f.model.handleCallback(callback(state)).isFailure)
        assertNull(f.store.value); assertNull(f.model.session.value.account); assertEquals(listOf(NEW_TOKEN), f.api.revoked)
    }
    @Test fun unreadableCredentialRequiresExplicitResetAndResetNeverCallsIssuer() = runTest {
        val f = AuthFixture(AuthStore(NativeCredential(TOKEN, EXPIRY)).apply { failRead = true })
        f.model.restore(); assertTrue(f.model.session.value.storageFailure); assertNotNull(f.store.value)
        assertTrue(f.model.resetLocalSession().isSuccess); assertNull(f.store.value)
        assertEquals(ShellAccess.SIGNED_OUT, f.model.session.value.access); assertTrue(f.api.requests.isEmpty())
    }
    @Test fun exactOptionalAccountPartitionIsAcceptedWithoutReplacingAccountID() {
        val contract = SoopAuthContract("qa")
        val withPartition = exchangeResponse().replace("\"authenticated\":true", "\"authenticated\":true,\"accountPartition\":\"${fingerprint("partition")}\"")
        assertEquals(OWN, contract.exchange(withPartition).session.account.id)
        assertThrows(InvalidResponse::class.java) { contract.exchange(withPartition.replace(fingerprint("partition"), "bad")) }
        assertThrows(InvalidResponse::class.java) { contract.exchange(withPartition.replace(fingerprint("partition"), "p".repeat(43))) }
        assertThrows(InvalidResponse::class.java) { NativeDtos.session(projection().replace("\"authenticated\":true", "\"authenticated\":true,\"accountPartition\":\"${"p".repeat(43)}\"")) }
    }
    @Test fun excessiveIssuedLifetimeIsRejectedAndOnlyReturnedTokenIsRevoked() = runTest {
        val f = AuthFixture(); val state = f.login()
        f.api.exchangeBlock = { exchangeResponse().replace(EXPIRY.toString(), NOW.plusSeconds(30 * 86400).toString()) }
        assertTrue(f.model.handleCallback(callback(state)).isFailure)
        assertNull(f.store.value); assertEquals(listOf(NEW_TOKEN), f.api.revoked)
    }
    @Test fun linkStartAuthoritative401ClearsOnlyCapturedOriginalSession() = runTest {
        val f = AuthFixture(AuthStore(NativeCredential(TOKEN, EXPIRY))); f.model.restore()
        f.api.startBlock = { throw ApiException(401, "UNAUTHENTICATED") }
        assertTrue(f.model.linkSoop().isFailure)
        assertNull(f.store.value); assertEquals(ShellAccess.SIGNED_OUT, f.model.session.value.access)
    }
    @Test fun linkSessionChangedRevalidatesOnlyCapturedScope() = runTest {
        val f = AuthFixture(AuthStore(NativeCredential(TOKEN, EXPIRY))); val state = f.link()
        f.api.exchangeBlock = { throw ApiException(401, "LINK_SESSION_CHANGED") }
        f.api.sessionBlock = { projection(linked = false, generation = "h".repeat(43)) }
        f.model.handleCallback(callback(state))
        assertEquals(2, f.api.sessionCalls); assertEquals(TOKEN, f.store.value?.token)
        assertEquals(OWN, f.model.session.value.account?.id)
    }
    @Test fun allPendingCancellationWritesFailVisibleRecoveryNeverClaimsCancelled() = runTest {
        val f = AuthFixture(); val state = f.login(); f.pending.failMarker = true
        assertTrue(f.model.cancelAuthentication().isFailure)
        assertEquals(AuthProblem.CANCEL_UNCONFIRMED, f.model.authState.value.error)
        f.model.handleCallback(callback(state)); assertEquals(1, f.api.requests.size)
        f.pending.failMarker = false; assertTrue(f.model.cancelAuthentication().isSuccess)
        val cold = f.coordinator(); cold.handleCallback(callback(state)); assertEquals(1, f.api.requests.size)
    }
    @Test fun publicStart401Unavailable404503AndOfflineNeverInventSuccessOrCredential() = runTest {
        listOf(ApiException(401, "UNAUTHENTICATED"), ApiException(404, null), ApiException(503, "AUTH_UNAVAILABLE"), IOException()).forEach { failure ->
            val f = AuthFixture(); f.model.restore(); f.api.startBlock = { throw failure }
            assertTrue(f.model.startLogin(CURRENT_TERMS).isFailure)
            assertNull(f.store.value); assertEquals(0, f.store.clears); assertNull(f.pending.value)
            assertEquals(ShellAccess.SIGNED_OUT, f.model.session.value.access)
        }
    }
    @Test fun authHttpUsesExactOptionalBearerHeadersNoCookieOriginOrRedirectReplayAndPreservesLinkError() = runTest {
        val calls = mutableListOf<io.ktor.client.request.HttpRequestData>()
        val client = ApiClient("https://api.qa.rogi.chat/v1/", MockEngine { request ->
            calls.add(request)
            if (request.url.encodedPath.endsWith("exchange")) respond("""{"error":{"code":"LINK_SESSION_CHANGED"}}""", HttpStatusCode.Unauthorized)
            else respond("", HttpStatusCode.Found, headersOf(HttpHeaders.Location, "https://other.example/"))
        })
        try {
            try { client.postAuth(ApiRoute.SOOP_START, null, "{}"); fail() } catch (e: ApiException) { assertEquals(302, e.statusCode) }
            try { client.postAuth(ApiRoute.SOOP_EXCHANGE, TOKEN, "{}"); fail() } catch (e: ApiException) { assertEquals("LINK_SESSION_CHANGED", e.code) }
            assertEquals(2, calls.size); assertNull(calls[0].headers[HttpHeaders.Authorization]); assertEquals("Bearer $TOKEN", calls[1].headers[HttpHeaders.Authorization])
            calls.forEach { r -> assertEquals("android", r.headers["X-Rogi-Client"]); assertNull(r.headers[HttpHeaders.Cookie]); assertNull(r.headers[HttpHeaders.Origin]); assertNull(r.headers["X-CSRF-Token"]) }
        } finally { client.close() }
    }
    @Test fun clearMarkerFailureUsesEncryptedConsumedFallbackAcrossColdRestart() = runTest {
        val key = KeyGenerator.getInstance("AES").apply { init(256) }.generateKey()
        val disk = object : CredentialDisk {
            var bytes: ByteArray? = null
            override fun read() = bytes
            override fun write(value: ByteArray) { bytes = value }
            override fun isCleared() = false
            override fun markCleared() { throw IOException("marker failure") }
            override fun removeClearMarker() = Unit
            override fun erase() { throw IOException("erase failure") }
        }
        val record = PendingAuth(TRANSACTION, AuthIntent.LOGIN, AuthProof("v".repeat(43), "s".repeat(43)), NOW, null, null, null, null)
        val original = ProtectedPendingAuthStore(disk, "qa", { key }); original.write(record)
        val oldBytes = disk.bytes!!.copyOf()
        try { original.clear(); fail() } catch (_: CredentialStoreException) { }
        assertFalse(oldBytes.contentEquals(disk.bytes))
        try { ProtectedPendingAuthStore(disk, "qa", { key }).read(); fail() } catch (_: CredentialStoreException) { }
        // The consumed record is authenticated but contains no verifier/state to restore or exchange.
        assertFalse(disk.bytes!!.toString(Charsets.ISO_8859_1).contains(record.proof.verifier))
    }
    @Test fun pendingProofIsAuthenticatedEnvironmentBoundAndTombstoneRecoveryIsDurable() = runTest {
        val key = KeyGenerator.getInstance("AES").apply { init(256) }.generateKey()
        val disk = object : CredentialDisk {
            var bytes: ByteArray? = null; var cleared = false; var failErase = false
            override fun read() = bytes
            override fun write(value: ByteArray) { bytes = value }
            override fun isCleared() = cleared
            override fun markCleared() { cleared = true }
            override fun removeClearMarker() { cleared = false }
            override fun erase() { if (failErase) throw IOException(); bytes = null }
        }
        val record = PendingAuth(TRANSACTION, AuthIntent.LOGIN, AuthProof("v".repeat(43), "s".repeat(43)), NOW, null, null, null, null)
        val store = ProtectedPendingAuthStore(disk, "qa", { key })
        store.write(record); assertFalse(disk.bytes!!.toString(Charsets.ISO_8859_1).contains(record.proof.verifier))
        assertEquals(record.proof.verifier, store.read()!!.proof.verifier)
        try { ProtectedPendingAuthStore(disk, "prod", { key }).read(); fail() } catch (_: CredentialStoreException) { }
        disk.failErase = true; try { store.clear(); fail() } catch (_: CredentialStoreException) { }
        try { ProtectedPendingAuthStore(disk, "qa", { key }).read(); fail() } catch (_: CredentialStoreException) { }
        disk.failErase = false; assertNull(store.read()); assertNull(disk.bytes)
    }
}
