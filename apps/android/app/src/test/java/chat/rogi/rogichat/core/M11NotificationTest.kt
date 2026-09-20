package chat.rogi.rogichat.core

import androidx.lifecycle.ViewModelStore
import chat.rogi.rogichat.core.network.*
import chat.rogi.rogichat.core.navigation.ShellAccess
import chat.rogi.rogichat.core.session.*
import chat.rogi.rogichat.feature.settings.*
import io.ktor.client.engine.mock.*
import io.ktor.client.request.HttpRequestData
import io.ktor.http.*
import io.ktor.http.content.TextContent
import java.io.IOException
import java.time.Clock
import java.time.Instant
import java.time.ZoneId
import java.time.ZoneOffset
import kotlinx.coroutines.*
import kotlinx.coroutines.test.*
import org.junit.Assert.*
import org.junit.Test

private fun prefs(enabled: Boolean = true, generation: String = "1") = NotificationPreferences(enabled, PreferenceGeneration(generation))
private fun prefsJson(enabled: Boolean = true, generation: String = "1") = """{"pushEnabled":$enabled,"generation":"$generation"}"""
private fun scope(model: NativeSessionCoordinator) = NotificationAccountScope(OWN, model.session.value.generation)
private val UI_SCOPE = NotificationAccountScope(OWN, 1)
private const val READ_CONTEXT = "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA"

private class PreferencesRepo : NotificationPreferencesRepository {
    var reads = 0
    val writes = mutableListOf<PreferenceGeneration>()
    var read: suspend () -> NotificationPreferences = { prefs() }
    var write: suspend (PreferenceGeneration) -> NotificationPreferences = { prefs(false, "2") }
    override suspend fun getPreferences(scope: NotificationAccountScope): Result<NotificationPreferences> {
        reads++; assertEquals(OWN, scope.accountId)
        return try { Result.success(read()) } catch (e: CancellationException) { throw e } catch (e: Exception) { Result.failure(e) }
    }
    override suspend fun disablePush(scope: NotificationAccountScope, expected: PreferenceGeneration): Result<NotificationPreferences> {
        writes.add(expected); assertEquals(OWN, scope.accountId)
        return try { Result.success(write(expected)) } catch (e: CancellationException) { throw e } catch (e: Exception) { Result.failure(e) }
    }
}
private class M11TestApi : NativeApi {
    var sessionJson = projection()
    var read: suspend () -> String = { prefsJson() }
    var write: suspend () -> String = { prefsJson(false, "2") }
    var reads = 0
    var writes = 0
    var body: String? = null
    override suspend fun get(route: ApiRoute, token: String): String = when (route) {
        ApiRoute.SESSION -> sessionJson
        ApiRoute.NOTIFICATION_PREFERENCES -> { reads++; read() }
        else -> error("unexpected route")
    }
    override suspend fun put(route: ApiRoute, token: String, body: String): String {
        assertEquals(ApiRoute.NOTIFICATION_PREFERENCES, route); assertEquals(TOKEN, token)
        this.body = body; writes++; return write()
    }
    override suspend fun patch(route: ApiRoute, token: String, body: String): String = error("unexpected PATCH")
    override suspend fun postWithoutResponse(route: ApiRoute, token: String, body: String) { assertEquals(ApiRoute.LOGOUT, route) }
}

@OptIn(ExperimentalCoroutinesApi::class)
class M11NotificationTest {
    @Test fun generationIsCanonicalPositiveUint64StringWithoutSignedLongTruncation() {
        for (value in listOf("1", "9223372036854775808", "18446744073709551615"))
            assertEquals(value, M11Dtos.preferences(prefsJson(generation = value)).generation.value)
        for (value in listOf("", "0", "01", "-1", "+1", "1.0", "1e2", " 1", "1 ", "１２", "18446744073709551616", "100000000000000000000"))
            assertThrows(InvalidResponse::class.java) { M11Dtos.preferences(prefsJson(generation = value)) }
        assertEquals("{\"pushEnabled\":false,\"expectedGeneration\":\"18446744073709551615\"}", M11Dtos.disable(PreferenceGeneration("18446744073709551615")))
    }
    @Test fun preferenceDecoderRejectsMissingNullNumericAndDuplicateFields() {
        for (value in listOf("{}", """{"pushEnabled":false}""", """{"pushEnabled":"false","generation":"1"}""",
            """{"pushEnabled":null,"generation":"1"}""", """{"pushEnabled":false,"generation":1}""",
            """{"pushEnabled":false,"generation":null}""", """{"pushEnabled":false,"generation":"1","generation":"2"}"""))
            assertThrows(InvalidResponse::class.java) { M11Dtos.preferences(value) }
    }
    @Test fun readStateRequiresCanonicalContextUuidAndExplicitMessageKey() {
        val decoded = M11Dtos.readStates("""{"readContext":"$READ_CONTEXT","items":[{"messageId":null},{"messageId":"$OWN"}]}""")
        assertEquals(listOf(null, ReadStateId(OWN)), decoded.items.map { it.messageId })
        assertNull(M11Dtos.readState("""{"messageId":null}""").messageId)
        assertThrows(InvalidResponse::class.java) { M11Dtos.readState("{}") }
        assertThrows(InvalidResponse::class.java) { M11Dtos.readState("""{"messageId":7}""") }
        for (context in listOf("B".repeat(43), "$READ_CONTEXT=", "A".repeat(42), "A".repeat(44)))
            assertThrows(InvalidResponse::class.java) { M11Dtos.readStates("""{"readContext":"$context","items":[]}""") }
        for (id in listOf("../../me/profile", "AAAAAAAA-AAAA-4AAA-8AAA-AAAAAAAAAAAA", OWN.replace("4000", "5000"), "https://other.example/"))
            assertThrows(IllegalArgumentException::class.java) { ReadStateId(id) }
        assertThrows(InvalidResponse::class.java) { M11Dtos.readStates("""{"readContext":"$READ_CONTEXT","items":[{}]}""") }
    }
    @Test fun readStateSnapshotBoundIs100AndEmptyDoesNotBecomeAnUnreadCount() {
        fun json(count: Int) = """{"readContext":"$READ_CONTEXT","items":[${List(count) { "{\"messageId\":null}" }.joinToString()}]}"""
        assertEquals(0, M11Dtos.readStates(json(0)).items.size)
        assertEquals(100, M11Dtos.readStates(json(100)).items.size)
        assertThrows(InvalidResponse::class.java) { M11Dtos.readStates(json(101)) }
        assertThrows(InvalidResponse::class.java) { M11Dtos.readStates("""{"readContext":"$READ_CONTEXT"}""") }
        assertEquals("{\"messageId\":\"$OWN\",\"readContext\":\"$READ_CONTEXT\"}", M11Dtos.displayed(ReadStateId(OWN), ReadContext(READ_CONTEXT)))
    }
    @Test fun realClientUsesExactMethodsBodiesHeadersAndValidatedRoomPath() = runTest {
        val calls = mutableListOf<HttpRequestData>()
        val client = ApiClient("https://api.qa.rogi.chat/v1/", MockEngine { request ->
            calls.add(request)
            when {
                request.url.encodedPath.endsWith("notification-preferences") -> respond(prefsJson(request.method == HttpMethod.Get))
                request.method == HttpMethod.Get -> respond("""{"readContext":"$READ_CONTEXT","items":[]}""")
                else -> respond("""{"messageId":null}""")
            }
        })
        try {
            NotificationApi(client).getPreferences(TOKEN)
            NotificationApi(client).disablePush(TOKEN, PreferenceGeneration("1"))
            val reads = ReadStateApi(client)
            reads.get(TOKEN, ReadStateId(OWN)); reads.reportDisplayed(TOKEN, ReadStateId(OWN), ReadStateId(OTHER), ReadContext(READ_CONTEXT))
            assertEquals(listOf(HttpMethod.Get, HttpMethod.Put, HttpMethod.Get, HttpMethod.Put), calls.map { it.method })
            assertEquals("/v1/me/notification-preferences", calls[0].url.encodedPath)
            assertEquals(M11Dtos.disable(PreferenceGeneration("1")), (calls[1].body as TextContent).text)
            assertEquals("/v1/rooms/$OWN/read-state", calls[2].url.encodedPath)
            assertEquals(M11Dtos.displayed(ReadStateId(OTHER), ReadContext(READ_CONTEXT)), (calls[3].body as TextContent).text)
            calls.forEach {
                assertEquals("api.qa.rogi.chat", it.url.host); assertEquals("Bearer $TOKEN", it.headers[HttpHeaders.Authorization])
                assertEquals("android", it.headers["X-Rogi-Client"]); assertNull(it.headers[HttpHeaders.Cookie])
                assertNull(it.headers[HttpHeaders.Origin]); assertNull(it.headers["X-CSRF-Token"]); assertTrue(it.url.parameters.isEmpty())
            }
        } finally { client.close() }
    }
    @Test fun m11TransportPreservesConflictAvailabilityAndReadStateErrorsWithoutRedirect() = runTest {
        for ((status, code) in listOf(409 to "CONFLICT", 503 to "AUTH_UNAVAILABLE", 403 to "SOOP_LINK_REQUIRED", 404 to "NOT_FOUND", 401 to "UNAUTHENTICATED")) {
            var requests = 0
            val client = ApiClient("https://api.rogi.chat/v1/", MockEngine {
                requests++; respond("""{"error":{"code":"$code"}}""", HttpStatusCode.fromValue(status))
            })
            try {
                val error = runCatching { ReadStateApi(client).get(TOKEN, ReadStateId(OWN)) }.exceptionOrNull() as ApiException
                assertEquals(status, error.statusCode); assertEquals(code, error.code); assertEquals(1, requests)
            } finally { client.close() }
        }
        var requests = 0
        val client = ApiClient("https://api.qa.rogi.chat/v1/", MockEngine {
            requests++; respond("", HttpStatusCode.TemporaryRedirect, headersOf(HttpHeaders.Location, "https://other.example/"))
        })
        try {
            assertTrue(runCatching { NotificationApi(client).getPreferences(TOKEN) }.exceptionOrNull() is ApiException)
            assertEquals(1, requests)
        } finally { client.close() }
    }
    @Test fun signedOutCannotReadAndLinkRequiredCanReadAndDisable() = runTest {
        val api = M11TestApi().apply { sessionJson = projection(linked = false) }
        val model = NativeSessionCoordinator(TestStore(), api, Clock.fixed(NOW, ZoneOffset.UTC))
        assertTrue(runCatching { model.getPreferences(scope(model)) }.exceptionOrNull() is CancellationException)
        assertEquals(0, api.reads)
        model.restore(); assertEquals(ShellAccess.LINK_REQUIRED, model.session.value.access)
        assertTrue(model.getPreferences(scope(model)).getOrThrow().pushEnabled)
        assertFalse(model.disablePush(scope(model), PreferenceGeneration("1")).getOrThrow().pushEnabled)
        assertEquals(M11Dtos.disable(PreferenceGeneration("1")), api.body)
        assertNotNull(model.services().notificationPreferences)
    }
    @Test fun malformedDisableResponseDoesNotInventSuccess() = runTest {
        val api = M11TestApi().apply { write = { prefsJson(true, "2") } }
        val model = NativeSessionCoordinator(TestStore(), api, Clock.fixed(NOW, ZoneOffset.UTC)); model.restore()
        assertTrue(model.disablePush(scope(model), PreferenceGeneration("1")).exceptionOrNull() is InvalidResponse)
    }
    @Test fun queuedOldScopeCannotCaptureCurrentCredentialEvenWithSameAccountAndCas() = runTest {
        val api = M11TestApi(); val model = NativeSessionCoordinator(TestStore(), api, Clock.fixed(NOW, ZoneOffset.UTC)); model.restore()
        val approvedScope = scope(model)
        val gate = CompletableDeferred<Unit>()
        val old = async { gate.await(); model.disablePush(approvedScope, PreferenceGeneration("1")) }; runCurrent()
        // Same account and same preference CAS; local authorization epoch alone distinguishes the intent.
        api.sessionJson = projection(generation = "h".repeat(43)); model.revalidate()
        gate.complete(Unit); runCurrent()
        assertTrue(old.isCancelled); assertEquals(0, api.writes)
        assertTrue(runCatching { model.getPreferences(approvedScope) }.exceptionOrNull() is CancellationException)
        assertEquals(0, api.reads)
        assertTrue(model.getPreferences(scope(model)).isSuccess)
    }
    @Test fun viewModelRetainsApprovalScopeAcrossRepositoryHopAndNeverReplaysCancelledCommand() = runTest {
        val api = M11TestApi(); val model = NativeSessionCoordinator(TestStore(), api, Clock.fixed(NOW, ZoneOffset.UTC)); model.restore()
        val approvedScope = scope(model)
        val gate = CompletableDeferred<Unit>()
        val repository = object : NotificationPreferencesRepository {
            override suspend fun getPreferences(scope: NotificationAccountScope) = model.getPreferences(scope)
            override suspend fun disablePush(scope: NotificationAccountScope, expected: PreferenceGeneration): Result<NotificationPreferences> {
                gate.await()
                assertEquals(approvedScope, scope)
                return model.disablePush(scope, expected)
            }
        }
        val ui = NotificationSettingsViewModel(repository, approvedScope, backgroundScope); runCurrent()
        ui.disablePush(); runCurrent()
        api.sessionJson = projection(generation = "h".repeat(43)); model.revalidate()
        gate.complete(Unit); runCurrent()
        assertEquals(0, api.writes); assertEquals(1, api.reads)
        assertFalse(ui.uiState.value.canDisable); assertTrue(ui.uiState.value.needsRefresh)
    }
    @Test fun featureOwnerAToBToAClearsOldModelAndSameAccountEpochRejectsItsWrite() = runTest {
        val gate = CompletableDeferred<Unit>()
        val api = M11TestApi(); val model = NativeSessionCoordinator(TestStore(), api, Clock.fixed(NOW, ZoneOffset.UTC)); model.restore()
        val oldScope = scope(model)
        val repository = object : NotificationPreferencesRepository {
            override suspend fun getPreferences(scope: NotificationAccountScope) = model.getPreferences(scope)
            override suspend fun disablePush(scope: NotificationAccountScope, expected: PreferenceGeneration): Result<NotificationPreferences> {
                withContext(NonCancellable) { gate.await() }
                return model.disablePush(scope, expected)
            }
        }
        // UI owners cycle A→B→A; coordinator stays account A with a changed server generation.
        // This tests scope teardown/admission, not an actual provider-driven account switch.
        val owner = SessionFeatureScope()
        val oldUi = NotificationSettingsViewModel(repository, oldScope, backgroundScope)
        owner.ownerFor(SessionScopeKey(oldScope.localEpoch, ShellAccess.READY, OWN)).viewModelStore.put("notifications", oldUi)
        runCurrent(); oldUi.disablePush(); runCurrent()
        owner.ownerFor(SessionScopeKey(oldScope.localEpoch + 1, ShellAccess.READY, OTHER))
        api.sessionJson = projection(generation = "h".repeat(43)); model.revalidate()
        val newScope = scope(model)
        val newUi = NotificationSettingsViewModel(repository, newScope, backgroundScope)
        owner.ownerFor(SessionScopeKey(newScope.localEpoch, ShellAccess.READY, OWN)).viewModelStore.put("notifications", newUi)
        runCurrent(); gate.complete(Unit); runCurrent()
        assertNull(oldUi.uiState.value.preferences); assertTrue(newUi.uiState.value.canDisable)
        assertEquals(0, api.writes)
    }
    @Test fun current401ClearsCredentialButLate401AfterScopeChangeDoesNot() = runTest {
        val store = TestStore(); val api = M11TestApi()
        val model = NativeSessionCoordinator(store, api, Clock.fixed(NOW, ZoneOffset.UTC)); model.restore()
        val response = CompletableDeferred<String>(); api.read = { response.await() }
        val old = async { model.getPreferences(scope(model)) }; runCurrent()
        api.sessionJson = projection(generation = "h".repeat(43)); model.revalidate()
        response.completeExceptionally(ApiException(401, "UNAUTHENTICATED")); runCurrent()
        assertTrue(old.isCancelled); assertNotNull(store.value); assertEquals(ShellAccess.READY, model.session.value.access)
        api.read = { throw ApiException(401, "UNAUTHENTICATED") }
        assertTrue(runCatching { model.getPreferences(scope(model)) }.exceptionOrNull() is CancellationException)
        assertNull(store.value); assertEquals(ShellAccess.SIGNED_OUT, model.session.value.access)
    }
    @Test fun delayedGetAndPutCannotReturnAfterLogout() = runTest {
        for (saving in listOf(false, true)) {
            val api = M11TestApi(); val model = NativeSessionCoordinator(TestStore(), api, Clock.fixed(NOW, ZoneOffset.UTC)); model.restore()
            val response = CompletableDeferred<String>(); api.read = { response.await() }; api.write = { response.await() }
            val old = async { if (saving) model.disablePush(scope(model), PreferenceGeneration("1")) else model.getPreferences(scope(model)) }; runCurrent()
            model.signOut(); response.complete(prefsJson(false, "2")); runCurrent()
            assertTrue(old.isCancelled); assertNull(model.session.value.account)
        }
    }
    @Test fun requestChecksExpiryBeforeAndAfterAwait() = runTest {
        var instant = NOW
        val clock = object : Clock() {
            override fun getZone(): ZoneId = ZoneOffset.UTC
            override fun withZone(zone: ZoneId): Clock = this
            override fun instant(): Instant = instant
        }
        for (saving in listOf(false, true)) {
            instant = NOW
            val store = TestStore(); val api = M11TestApi()
            val model = NativeSessionCoordinator(store, api, clock); model.restore()
            val response = CompletableDeferred<String>(); api.read = { response.await() }; api.write = { response.await() }
            val old = async { if (saving) model.disablePush(scope(model), PreferenceGeneration("1")) else model.getPreferences(scope(model)) }; runCurrent()
            instant = EXPIRY; response.complete(prefsJson(false, "2")); runCurrent()
            assertTrue(old.isCancelled); assertNull(store.value)
        }
        instant = NOW
        val store = TestStore(); val api = M11TestApi(); val model = NativeSessionCoordinator(store, api, clock); model.restore()
        instant = EXPIRY
        assertTrue(runCatching { model.getPreferences(scope(model)) }.exceptionOrNull() is CancellationException)
        assertEquals(0, api.reads); assertNull(store.value)
    }
    @Test fun initialFalseAndRefreshNeverIssuePutOrAssumeDefaultTrue() = runTest {
        val repository = PreferencesRepo().apply { read = { prefs(false) } }
        val model = NotificationSettingsViewModel(repository, UI_SCOPE, backgroundScope)
        assertNull(model.uiState.value.preferences); assertFalse(model.uiState.value.canDisable)
        runCurrent(); assertFalse(model.uiState.value.preferences!!.pushEnabled)
        repeat(3) { model.loadPreferences(); runCurrent(); model.disablePush() }
        assertTrue(repository.writes.isEmpty())
    }
    @Test fun initialReadFailureRemainsUnknownAndNeedsExplicitRetry() = runTest {
        val repo = PreferencesRepo().apply { read = { throw IOException() } }
        val model = NotificationSettingsViewModel(repo, UI_SCOPE, backgroundScope); runCurrent()
        assertNull(model.uiState.value.preferences); assertTrue(model.uiState.value.needsRefresh)
        assertNotNull(model.uiState.value.error); assertFalse(model.uiState.value.canDisable)
        repo.read = { prefs() }; model.loadPreferences(); runCurrent()
        assertTrue(model.uiState.value.canDisable); assertNull(model.uiState.value.error); assertTrue(repo.writes.isEmpty())
    }
    @Test fun disableIsSingleFlightAndKeepsConfirmedValueUntilResponse() = runTest {
        val response = CompletableDeferred<NotificationPreferences>()
        val repo = PreferencesRepo().apply { write = { response.await() } }
        val model = NotificationSettingsViewModel(repo, UI_SCOPE, backgroundScope); runCurrent()
        repeat(5) { model.disablePush() }; model.loadPreferences(); runCurrent()
        assertEquals(1, repo.writes.size); assertEquals(1, repo.reads)
        assertTrue(model.uiState.value.preferences!!.pushEnabled); assertTrue(model.uiState.value.isSaving)
        response.complete(prefs(false, "2")); runCurrent()
        assertFalse(model.uiState.value.preferences!!.pushEnabled); assertFalse(model.uiState.value.isSaving)
    }
    @Test fun lateGetCannotOverwriteSuccessfulMutationOrItsGeneration() = runTest {
        val late = CompletableDeferred<NotificationPreferences>()
        val repo = PreferencesRepo().apply { read = { withContext(NonCancellable) { late.await() } } }
        val model = NotificationSettingsViewModel(repo, UI_SCOPE, backgroundScope); runCurrent()
        repo.read = { prefs(true, "2") }; model.loadPreferences(); runCurrent()
        repo.write = { prefs(false, "3") }; model.disablePush(); runCurrent()
        late.complete(prefs(true, "1")); runCurrent()
        assertEquals(prefs(false, "3"), model.uiState.value.preferences)
        assertEquals(listOf(PreferenceGeneration("2")), repo.writes)
    }
    @Test fun conflictRefreshesWithoutReplayingAndOnlyNewChoiceWritesAgain() = runTest {
        val repo = PreferencesRepo(); val model = NotificationSettingsViewModel(repo, UI_SCOPE, backgroundScope); runCurrent()
        repo.write = { throw ApiException(409, "CONFLICT") }; repo.read = { prefs(true, "8") }
        model.disablePush(); runCurrent()
        assertEquals(1, repo.writes.size); assertEquals(2, repo.reads)
        assertEquals(prefs(true, "8"), model.uiState.value.preferences); assertNotNull(model.uiState.value.error)
        repo.write = { prefs(false, "9") }; model.disablePush(); runCurrent()
        assertEquals(listOf(PreferenceGeneration("1"), PreferenceGeneration("8")), repo.writes)
        assertEquals(prefs(false, "9"), model.uiState.value.preferences)
    }
    @Test fun lostResponseReadsCurrentFalseWithoutClaimingOriginalWriteSucceeded() = runTest {
        val repo = PreferencesRepo(); val model = NotificationSettingsViewModel(repo, UI_SCOPE, backgroundScope); runCurrent()
        repo.write = { throw IOException() }; repo.read = { prefs(false, "2") }
        model.disablePush(); runCurrent(); model.disablePush(); runCurrent()
        assertEquals(1, repo.writes.size); assertEquals(2, repo.reads)
        assertFalse(model.uiState.value.preferences!!.pushEnabled); assertNotNull(model.uiState.value.error)
    }
    @Test fun failedReconciliationBlocksWritesUntilReadSucceedsAndRequiresFreshChoice() = runTest {
        val repo = PreferencesRepo(); val model = NotificationSettingsViewModel(repo, UI_SCOPE, backgroundScope); runCurrent()
        repo.write = { throw ApiException(503, "AUTH_UNAVAILABLE") }; repo.read = { throw IOException() }
        model.disablePush(); runCurrent(); model.disablePush(); runCurrent()
        assertTrue(model.uiState.value.needsRefresh); assertFalse(model.uiState.value.canDisable); assertEquals(1, repo.writes.size)
        repo.read = { prefs(true, "4") }; model.loadPreferences(); runCurrent()
        assertTrue(model.uiState.value.canDisable); assertEquals(1, repo.writes.size)
    }
    @Test fun clearDropsAccountDataAndCancelledLateSaveCannotAffectNewScope() = runTest {
        val late = CompletableDeferred<NotificationPreferences>()
        val repo = PreferencesRepo().apply { write = { withContext(NonCancellable) { late.await() } } }
        val original = NotificationSettingsViewModel(repo, UI_SCOPE, backgroundScope)
        val owner = ViewModelStore().apply { put("notifications", original) }; runCurrent()
        original.disablePush(); runCurrent(); owner.clear()
        val replacement = NotificationSettingsViewModel(PreferencesRepo().apply { read = { prefs(true, "9") } }, UI_SCOPE, backgroundScope); runCurrent()
        late.complete(prefs(false, "2")); runCurrent()
        assertNull(original.uiState.value.preferences); assertEquals(prefs(true, "9"), replacement.uiState.value.preferences)
    }
}
