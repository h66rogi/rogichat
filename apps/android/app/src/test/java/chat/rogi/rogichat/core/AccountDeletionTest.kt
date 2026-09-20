package chat.rogi.rogichat.core

import chat.rogi.rogichat.core.auth.*
import chat.rogi.rogichat.core.deletion.*
import chat.rogi.rogichat.core.network.*
import chat.rogi.rogichat.core.session.*
import chat.rogi.rogichat.core.navigation.ShellAccess
import io.ktor.client.engine.mock.*
import io.ktor.http.*
import io.ktor.http.content.TextContent
import kotlinx.coroutines.*
import kotlinx.coroutines.test.*
import java.time.*
import java.io.IOException
import java.util.UUID
import javax.crypto.KeyGenerator
import org.junit.Assert.*
import org.junit.Test

internal const val RECEIPT = "00000000-0000-5000-8000-000000000001"
internal fun deletionAck() = """{"requestId":"$RECEIPT","status":"blocked"}"""
private class DeletionTokens(var value: NativeCredential? = NativeCredential(TOKEN, EXPIRY)) : CredentialStore {
    var stamp: String? = null; var clears = 0; var failClear = false; var afterWrite: suspend () -> Unit = {}
    override suspend fun read() = value
    override suspend fun write(credential: NativeCredential) { value = credential; stamp = null; afterWrite() }
    override suspend fun clear() { stamp = fingerprint("clear-${++clears}"); if (failClear) throw CredentialStoreException(); value = null }
    override suspend fun clearStamp() = stamp
}
private class DeletionJournal : AccountDeletionStore {
    var records = emptyList<DeletionRecord>(); var failRead = false; var erases = 0
    var beforeWrite: suspend (List<DeletionRecord>) -> Unit = {}
    override suspend fun read(): List<DeletionRecord> { if (failRead) throw DeletionStorageException(); return records }
    override suspend fun write(records: List<DeletionRecord>) { beforeWrite(records); this.records = DeletionJournalCodec.decode(DeletionJournalCodec.encode(records)) }
    override suspend fun erase() { erases++; records = emptyList(); failRead = false }
}
private class DeletionApi : NativeApi {
    var deletes = 0; var gets = 0; var session = projection(); var deleted: suspend (String) -> String = { deletionAck() }
    var authToken = fingerprint("new-account-token")
    override suspend fun deleteAccount(token: String): String { deletes++; return deleted(token) }
    override suspend fun get(route: ApiRoute, token: String): String { assertEquals(ApiRoute.SESSION, route); gets++; return session }
    override suspend fun patch(route: ApiRoute, token: String, body: String) = error("unexpected")
    override suspend fun postWithoutResponse(route: ApiRoute, token: String, body: String) = Unit
    override suspend fun postAuth(route: ApiRoute, token: String?, body: String): String {
        assertNull(token)
        return when (route) {
            ApiRoute.SOOP_START -> """{"transactionId":"$OTHER","authorizeUrl":"https://api.qa.rogi.chat/v1/auth/native/soop/launch?request=${"r".repeat(43)}","expiresIn":600}"""
            ApiRoute.SOOP_EXCHANGE -> """{"tokenType":"Bearer","accessToken":"$authToken","expiresAt":"$EXPIRY","session":$session}"""
            else -> error("unexpected")
        }
    }
}
private class DeletionFixture(val owner: CoroutineScope, val clock: Clock = Clock.fixed(NOW, ZoneOffset.UTC)) {
    val tokens = DeletionTokens(); val journal = DeletionJournal(); val api = DeletionApi(); val db = RoomTestStore()
    var pending: PendingAuth? = null
    private val pendingStore = object : PendingAuthStore {
        override suspend fun read() = pending
        override suspend fun write(value: PendingAuth) { pending = value }
        override suspend fun clear() { pending = null }
    }
    fun cold() = NativeSessionCoordinator(tokens, api, clock,
        SoopAuthSupport(SoopAuthContract("qa"), pendingStore), db, journal, owner)
    val model = cold()
    suspend fun start() { model.restore().getOrThrow() }
    fun intent() = model.session.value.let { DeletionIntent(requireNotNull(it.account).id, it.generation, UUID.randomUUID().toString()) }
    fun resetIntent() = DeletionResetIntent.from(model.session.value, model.deletionState.value)
    suspend fun loginAs(account: String) {
        api.session = projection().replace(OWN, account)
        model.startLogin(CURRENT_TERMS).getOrThrow()
        val state = requireNotNull(pending).proof.state
        model.handleCallback("https://qa.rogi.chat/mobile/auth/complete?code=${"c".repeat(43)}&state=$state").getOrThrow()
    }
}
@OptIn(ExperimentalCoroutinesApi::class)
class AccountDeletionTest {
    @Test fun transportUsesExactDeleteAndStrict403WithoutRetryOrReceiptGet() = runTest {
        for ((status, body, code) in listOf(Triple(HttpStatusCode.OK, deletionAck(), null),
            Triple(HttpStatusCode.Forbidden, """{"error":{"code":"RECENT_AUTH_REQUIRED"}}""", "RECENT_AUTH_REQUIRED"),
            Triple(HttpStatusCode.Forbidden, """{"error":{"code":"WRONG","code":"RECENT_AUTH_REQUIRED"}}""", null))) {
            var calls = 0
            val client = ApiClient("https://api.qa.rogi.chat/v1/", MockEngine {
                calls++; assertEquals(HttpMethod.Delete, it.method); assertEquals("/v1/me/account", it.url.encodedPath)
                assertEquals("{}", (it.body as TextContent).text); assertEquals("Bearer $TOKEN", it.headers[HttpHeaders.Authorization])
                assertEquals("android", it.headers["X-Rogi-Client"]); assertNull(it.headers[HttpHeaders.Cookie]); assertNull(it.headers[HttpHeaders.Origin])
                respond(body, status)
            })
            val result = runCatching { client.deleteAccount(TOKEN) }
            if (status == HttpStatusCode.OK) assertEquals(RECEIPT, AccountDeletionDto.receipt(result.getOrThrow()).requestId)
            else assertEquals(code, (result.exceptionOrNull() as ApiException).code)
            assertEquals(1, calls); client.close()
        }
    }
    @Test fun deletionRejectsNon200BodiesAndRedirectWithoutFollowingOrRetry() = runTest {
        for (status in listOf(HttpStatusCode.Accepted, HttpStatusCode.NoContent, HttpStatusCode.Found, HttpStatusCode.ServiceUnavailable)) {
            var calls = 0
            val client = ApiClient("https://api.rogi.chat/v1/", MockEngine {
                calls++; respond(deletionAck(), status, headersOf(HttpHeaders.Location, "https://example.com"))
            })
            assertTrue(runCatching { client.deleteAccount(TOKEN) }.isFailure)
            assertEquals(1, calls); client.close()
        }
    }
    @Test fun linkRequiredMayRequestDeletionAndRecentAuthDoesNotErasePriorUnknown() = runTest {
        val f = DeletionFixture(backgroundScope)
        val prior = DeletionRecord(UUID.randomUUID().toString(), OWN, fingerprint("previous-token"), null,
            phase = DeletionPhase.UNKNOWN, cleanupPending = false)
        f.journal.records = listOf(prior); f.api.session = projection(linked = false)
        f.start(); assertEquals(ShellAccess.LINK_REQUIRED, f.model.session.value.access)
        f.api.deleted = { throw ApiException(403, "RECENT_AUTH_REQUIRED") }
        f.model.requestDeletion(f.intent()); runCurrent()
        assertEquals(ShellAccess.LINK_REQUIRED, f.model.session.value.access)
        assertEquals(1, f.api.deletes); assertEquals(prior, f.journal.records.first())
        assertEquals(DeletionPhase.REAUTH_DONE, f.journal.records.last().phase)
    }
    @Test fun acknowledgementRequiresBlockedAndLowercaseV4OrV5Uuid() {
        assertEquals(RECEIPT, AccountDeletionDto.receipt(deletionAck()).requestId)
        assertEquals(OWN, AccountDeletionDto.receipt(deletionAck().replace(RECEIPT, OWN)).requestId)
        for (invalid in listOf(deletionAck().replace("blocked", "completed"), deletionAck().replace("-5000-", "-6000-"),
            deletionAck().replace("\"status\":\"blocked\"", "\"status\":\"unknown\",\"status\":\"blocked\""), "{}"))
            assertThrows(InvalidResponse::class.java) { AccountDeletionDto.receipt(invalid) }
    }
    @Test fun originalCredentialAndDbAreClearedBeforeOnlyDeleteAndAckIsDurable() = runTest {
        val f = DeletionFixture(backgroundScope); f.start()
        f.api.deleted = { token ->
            assertEquals(TOKEN, token); assertNull(f.tokens.value); assertNotNull(f.tokens.stamp)
            assertEquals(DeletionPhase.SENDING, f.journal.records.single().phase); assertTrue(f.db.clears > 0); deletionAck()
        }
        f.model.requestDeletion(f.intent()).getOrThrow(); assertNull(f.model.session.value.account); runCurrent()
        assertEquals(1, f.api.deletes); assertEquals(1, f.api.gets)
        assertEquals(RECEIPT, f.journal.records.single().receipt!!.requestId); assertFalse(f.journal.records.single().cleanupPending)
        assertEquals(ShellAccess.SIGNED_OUT, f.model.session.value.access)
        f.cold().restore().getOrThrow(); assertEquals(1, f.api.deletes); assertEquals(1, f.api.gets)
    }
    @Test fun pendingJournalCredentialAndDbFailuresBeforeDispatchSendZeroDeletes() = runTest {
        for (stage in listOf("journal", "credential", "db")) {
            val f = DeletionFixture(backgroundScope); f.start()
            when (stage) {
                "journal" -> f.journal.beforeWrite = { throw DeletionStorageException() }
                "credential" -> f.tokens.failClear = true
                "db" -> f.db.failClear = true
            }
            f.model.requestDeletion(f.intent()); runCurrent()
            assertEquals(0, f.api.deletes); assertTrue(f.model.deletionState.value.storageFailure)
            f.journal.beforeWrite = {}; f.tokens.failClear = false; f.db.failClear = false
            f.model.retryDeletionCleanup().getOrThrow(); assertEquals(0, f.api.deletes)
            assertEquals(DeletionPhase.ABORTED, f.model.deletionState.value.record!!.phase)
        }
    }
    @Test fun unknownPersistsAcrossColdStartAndSessionGetDoesNotResolveAdmission() = runTest {
        for (failure in listOf(IOException(), ApiException(503, "UNAVAILABLE"), ApiException(401, "UNAUTHENTICATED"))) {
            val f = DeletionFixture(backgroundScope); f.start(); f.api.deleted = { throw failure }
            f.model.requestDeletion(f.intent()); runCurrent()
            assertEquals(DeletionPhase.UNKNOWN, f.journal.records.single().phase); assertNull(f.tokens.value)
            val cold = f.cold(); cold.restore().getOrThrow(); cold.retryDeletionCleanup()
            assertEquals(DeletionPhase.UNKNOWN, cold.deletionState.value.record!!.phase); assertEquals(1, f.api.deletes); assertEquals(1, f.api.gets)
        }
    }
    @Test fun strictRecentAuthRestoresOnlyLiveOriginalThenUsesRealSessionGet() = runTest {
        val f = DeletionFixture(backgroundScope); f.start(); f.api.deleted = { throw ApiException(403, "RECENT_AUTH_REQUIRED") }
        f.model.requestDeletion(f.intent()); runCurrent()
        assertEquals(ShellAccess.READY, f.model.session.value.access); assertEquals(TOKEN, f.tokens.value!!.token)
        assertEquals(2, f.api.gets); assertEquals(1, f.api.deletes); assertEquals(DeletionPhase.REAUTH_DONE, f.journal.records.single().phase)
    }
    @Test fun coldClearBeforeStampAndRestoreBeforeCompletionCleanOnlyOriginal() = runTest {
        for (phase in listOf(DeletionPhase.PREPARING, DeletionPhase.SENDING, DeletionPhase.REAUTH_RESTORING)) {
            val f = DeletionFixture(backgroundScope)
            f.journal.records = listOf(DeletionRecord(UUID.randomUUID().toString(), OWN, fingerprint(TOKEN), null,
                fingerprint("original-clear"), phase))
            if (phase == DeletionPhase.PREPARING) { f.tokens.value = null; f.tokens.stamp = fingerprint("new-clear-before-journal") }
            f.model.restore().getOrThrow()
            assertNull(f.tokens.value); assertFalse(f.journal.records.single().cleanupPending)
            assertEquals(0, f.api.deletes); assertEquals(0, f.api.gets)
        }
        val f = DeletionFixture(backgroundScope)
        f.journal.records = listOf(DeletionRecord(UUID.randomUUID().toString(), OWN, fingerprint(TOKEN), null, phase = DeletionPhase.REAUTH_RESTORING))
        val newer = NativeCredential(fingerprint("account-B"), EXPIRY); f.tokens.value = newer
        assertTrue(f.model.restore().isFailure); assertSame(newer, f.tokens.value); assertEquals(0, f.db.clears)
    }
    @Test fun credentialWriteThenFailureLeavesRestorationPhaseAndColdNeverRestoresIt() = runTest {
        val f = DeletionFixture(backgroundScope); f.start()
        f.api.deleted = { throw ApiException(403, "RECENT_AUTH_REQUIRED") }
        f.tokens.afterWrite = { throw CredentialStoreException() } // bytes written, marker removed, journal incomplete.
        f.model.requestDeletion(f.intent()); runCurrent()
        assertEquals(TOKEN, f.tokens.value!!.token); assertNull(f.tokens.stamp)
        assertEquals(DeletionPhase.REAUTH_RESTORING, f.journal.records.single().phase)
        assertTrue(f.model.deletionState.value.storageFailure)
        f.tokens.afterWrite = {}; val cold = f.cold(); cold.restore().getOrThrow()
        assertNull(f.tokens.value); assertEquals(ShellAccess.SIGNED_OUT, cold.session.value.access)
        assertEquals(1, f.api.gets); assertEquals(1, f.api.deletes)
    }
    @Test fun missingCredentialAndChangedStampDoNotConsumeNewUnboundProofDuringForeignDbFailure() = runTest {
        val f = DeletionFixture(backgroundScope)
        f.tokens.value = null; f.tokens.stamp = fingerprint("new-account-clear")
        val nextProof = PendingAuth(UUID.randomUUID().toString(), AuthIntent.LOGIN, AuthProof.create(), NOW, null, null, null, f.tokens.stamp)
        f.pending = nextProof
        f.journal.records = listOf(DeletionRecord(UUID.randomUUID().toString(), OWN, fingerprint(TOKEN), null,
            fingerprint("old-clear"), DeletionPhase.SENDING, accountPartition = PARTITION.value))
        f.db.beforeClear = { throw chat.rogi.rogichat.core.rooms.RoomsStorageException() }
        assertTrue(f.model.restore().isFailure)
        assertSame(nextProof, f.pending); assertEquals(0, f.tokens.clears); assertEquals(0, f.api.deletes)
        assertEquals(0, f.api.gets); assertTrue(f.journal.records.single().cleanupPending)
    }
    @Test fun duplicateAndViewModelCancellationDoNotReleaseDispatchOrInstallNewAccount() = runTest {
        val f = DeletionFixture(backgroundScope); f.start(); val intent = f.intent(); val gate = CompletableDeferred<Unit>()
        f.api.deleted = { gate.await(); deletionAck() }
        val uiJob = SupervisorJob()
        val firstUi = SessionViewModel(f.model.services(), CoroutineScope(uiJob + StandardTestDispatcher(testScheduler)))
        firstUi.deleteAccount(intent); runCurrent()
        androidx.lifecycle.ViewModelStore().apply { put("session", firstUi); clear() }
        uiJob.cancel(); runCurrent() // The feature/caller is gone; the session-owned DELETE is still held.
        assertEquals(1, f.api.deletes)
        assertTrue(f.model.startLogin(CURRENT_TERMS).exceptionOrNull() is DeletionInProgress)
        assertTrue(f.model.resetDeletionData(f.resetIntent()).exceptionOrNull() is DeletionInProgress)
        val ui = SessionViewModel(f.model.services(), backgroundScope)
        ui.deleteAccount(intent); runCurrent(); assertEquals(1, f.api.deletes)
        gate.complete(Unit); runCurrent(); f.loginAs(OTHER)
        val before = f.model.session.value
        ui.deleteAccount(intent); runCurrent()
        assertEquals(before, f.model.session.value); assertEquals(1, f.api.deletes)
        val tokenB = f.tokens.value; val clearCount = f.tokens.clears
        f.model.retryDeletionCleanup(); assertSame(tokenB, f.tokens.value); assertEquals(clearCount, f.tokens.clears)
        assertTrue(runCatching { f.model.requestDeletion(intent) }.exceptionOrNull() is CancellationException)
        f.model.signOut().getOrThrow(); f.api.authToken = fingerprint("return-account-A"); f.loginAs(OWN)
        val returned = f.model.session.value
        ui.deleteAccount(intent); runCurrent()
        assertEquals(returned, f.model.session.value); assertEquals(1, f.api.deletes)
        assertTrue(runCatching { f.model.requestDeletion(intent) }.exceptionOrNull() is CancellationException)
    }
    @Test fun oldResetDialogAndQueuedResetCannotClearBOrReturningA() = runTest {
        for (returnToA in listOf(false, true)) {
            val f = DeletionFixture(backgroundScope); f.start()
            f.model.requestDeletion(f.intent()); runCurrent()
            val original = f.resetIntent() // Signed-out A receipt and the exact local epoch shown in the dialog.
            val entered = CompletableDeferred<Unit>(); val release = CompletableDeferred<Unit>()
            val delayed = object : AccountDeletionActions by f.model {
                override suspend fun resetDeletionData(intent: DeletionResetIntent): Result<Unit> {
                    entered.complete(Unit); release.await(); return f.model.resetDeletionData(intent)
                }
            }
            val ui = SessionViewModel(ProductServices(f.model.session, f.model, deletion = delayed), backgroundScope)
            ui.resetDeletionData(original); runCurrent(); entered.await() // VM admitted A; coordinator not entered yet.
            f.loginAs(OTHER)
            if (returnToA) { f.model.signOut().getOrThrow(); f.api.authToken = fingerprint("new-A-reset"); f.loginAs(OWN) }
            val current = f.model.session.value; val token = f.tokens.value; val records = f.journal.records
            val clears = f.tokens.clears; val purges = f.db.clears; val erases = f.journal.erases
            release.complete(Unit); runCurrent()
            ui.resetDeletionData(original); runCurrent() // The old rendered dialog is rejected before UI changes too.
            assertEquals(current, f.model.session.value); assertSame(token, f.tokens.value)
            assertEquals(clears, f.tokens.clears); assertEquals(purges, f.db.clears); assertEquals(erases, f.journal.erases)
            assertEquals(records, f.journal.records); assertEquals(1, f.api.deletes); assertNull(ui.state.value.error)
        }
    }
    @Test fun resetIntentPinsReceiptIdentityEvenWithoutSessionChange() = runTest {
        val f = DeletionFixture(backgroundScope); f.start()
        val original = f.resetIntent()
        val wrongRecord = original.copy(operationId = UUID.randomUUID().toString())
        val clears = f.tokens.clears; val purges = f.db.clears
        assertTrue(runCatching { f.model.resetDeletionData(wrongRecord) }.exceptionOrNull() is CancellationException)
        assertEquals(clears, f.tokens.clears); assertEquals(purges, f.db.clears); assertEquals(0, f.journal.erases)
        f.model.resetDeletionData(original).getOrThrow()
        assertEquals(1, f.journal.erases); assertNull(f.tokens.value); assertEquals(0, f.api.deletes)
    }
    @Test fun queuedReauthenticationLogoutAndLocalResetKeepOriginalIdentity() = runTest {
        for (operation in listOf("logout", "reset")) {
            val f = DeletionFixture(backgroundScope); f.start()
            val old = SessionIdentity.from(f.model.session.value)
            val entered = CompletableDeferred<Unit>(); val release = CompletableDeferred<Unit>()
            val delayed = object : SessionActions by f.model {
                override suspend fun signOut(expected: SessionIdentity?): Result<Unit> {
                    entered.complete(Unit); release.await(); return f.model.signOut(expected)
                }
            }
            val ui = SessionViewModel(ProductServices(f.model.session, delayed), backgroundScope)
            if (operation == "logout") { ui.signOut(old); runCurrent(); entered.await() }
            f.model.signOut().getOrThrow(); f.loginAs(OTHER)
            val before = f.model.session.value; val token = f.tokens.value
            val clears = f.tokens.clears; val purges = f.db.clears
            if (operation == "logout") { release.complete(Unit); runCurrent() }
            else assertTrue(runCatching { f.model.resetLocalSession(old) }.exceptionOrNull() is CancellationException)
            ui.signOut(old); ui.resetLocalSession(old); runCurrent()
            assertEquals(before, f.model.session.value); assertSame(token, f.tokens.value)
            assertEquals(clears, f.tokens.clears); assertEquals(purges, f.db.clears); assertEquals(0, f.api.deletes)
        }
    }
    @Test fun expiryOrLogoutAfterSendingJournalWritePreventsDispatch() = runTest {
        for (logout in listOf(false, true)) {
            var now = NOW
            val clock = object : Clock() { override fun instant() = now; override fun getZone() = ZoneOffset.UTC; override fun withZone(zone: ZoneId) = this }
            val f = DeletionFixture(backgroundScope, clock); f.start()
            val writing = CompletableDeferred<Unit>(); val release = CompletableDeferred<Unit>()
            f.journal.beforeWrite = { if (it.last().phase == DeletionPhase.SENDING) { writing.complete(Unit); release.await() } }
            f.model.requestDeletion(f.intent()); runCurrent(); writing.await()
            if (logout) {
                // Queue logout on the same lifecycle mutex while required storage IO is suspended.
                backgroundScope.launch { f.model.signOut() }; runCurrent()
            } else now = EXPIRY
            release.complete(Unit); runCurrent()
            assertEquals(0, f.api.deletes)
            assertEquals(DeletionPhase.ABORTED, f.model.deletionState.value.record!!.phase)
        }
    }
    @Test fun explicitLogoutDuringResponseWaitForbidsRecentAuthCredentialResurrection() = runTest {
        val f = DeletionFixture(backgroundScope); f.start(); val response = CompletableDeferred<Unit>()
        f.api.deleted = { response.await(); throw ApiException(403, "RECENT_AUTH_REQUIRED") }
        f.model.requestDeletion(f.intent()); runCurrent(); f.model.signOut()
        response.complete(Unit); runCurrent()
        assertNull(f.tokens.value); assertEquals(1, f.api.gets)
        assertEquals(DeletionPhase.REAUTH_DONE, f.model.deletionState.value.record!!.phase)
    }
    @Test fun acknowledgementWriteFailureRetainsMemoryAckAndRetriesOnlyLocalPersistence() = runTest {
        val f = DeletionFixture(backgroundScope); f.start()
        f.journal.beforeWrite = { if (it.last().phase == DeletionPhase.BLOCKED) throw DeletionStorageException() }
        f.model.requestDeletion(f.intent()); runCurrent()
        assertEquals(RECEIPT, f.model.deletionState.value.record!!.receipt!!.requestId)
        assertTrue(f.model.deletionState.value.storageFailure); assertNull(f.tokens.value)
        f.journal.beforeWrite = {}; f.model.retryDeletionCleanup().getOrThrow()
        assertEquals(1, f.api.deletes); assertEquals(RECEIPT, f.journal.records.single().receipt!!.requestId)
    }
    @Test fun capacityHasAuthHeadroomAndCorruptJournalRequiresExplicitLocalReset() = runTest {
        val f = DeletionFixture(backgroundScope)
        f.journal.records = (1..16).map { DeletionRecord(UUID.randomUUID().toString(), OWN, fingerprint("old-$it"), null,
            phase = DeletionPhase.UNKNOWN, cleanupPending = false) }
        f.start(); assertEquals(ShellAccess.READY, f.model.session.value.access)
        assertTrue(f.model.requestDeletion(f.intent()).exceptionOrNull() is DeletionCapacityExceeded)
        assertEquals(0, f.api.deletes); assertEquals(16, f.journal.records.size)
        f.model.resetDeletionData(f.resetIntent()).getOrThrow(); assertTrue(f.journal.records.isEmpty()); assertNull(f.tokens.value)
        val bad = DeletionFixture(backgroundScope); bad.journal.failRead = true
        assertTrue(bad.model.restore().isFailure); assertEquals(0, bad.api.gets)
        bad.model.resetDeletionData(bad.resetIntent()).getOrThrow(); assertEquals(ShellAccess.SIGNED_OUT, bad.model.session.value.access)
    }
}
