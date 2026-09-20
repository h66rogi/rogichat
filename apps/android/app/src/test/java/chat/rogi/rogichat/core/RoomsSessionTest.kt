package chat.rogi.rogichat.core

import chat.rogi.rogichat.core.network.*
import chat.rogi.rogichat.core.rooms.*
import chat.rogi.rogichat.core.session.*
import chat.rogi.rogichat.core.navigation.ShellAccess
import java.time.*
import kotlinx.coroutines.*
import kotlinx.coroutines.test.*
import org.junit.Assert.*
import org.junit.Test

internal class RoomTestApi : NativeApi {
    var sessionJson = partitionProjection()
    var sessionCalls = 0
    var manifestCalls = 0; var discoveryCalls = 0
    var joins = 0; var leaves = 0
    var authResponse: suspend (ApiRoute) -> String = { error("unused") }
    override suspend fun postAuth(route: ApiRoute, token: String?, body: String): String {
        check(token == null); return authResponse(route)
    }
    var join: suspend (String, RoomId) -> String = { _, _ -> joinJson() }
    var leave: suspend (String, RoomId) -> Unit = { _, _ -> }
    override suspend fun joinRoom(token: String, room: RoomId): String { joins++; return join(token, room) }
    override suspend fun leaveRoom(token: String, room: RoomId) { leaves++; leave(token, room) }
    var manifest: suspend (ManifestRequest) -> String = { manifestJson() }
    var discovery: suspend (RoomId?) -> String = { discoveryJson() }
    override suspend fun get(route: ApiRoute, token: String): String { sessionCalls++; return sessionJson }
    override suspend fun getRooms(token: String, after: RoomId?): String { discoveryCalls++; return discovery(after) }
    override suspend fun getManifest(token: String, query: ManifestRequest): String { manifestCalls++; return manifest(query) }
    override suspend fun patch(route: ApiRoute, token: String, body: String) = error("unused")
    override suspend fun postWithoutResponse(route: ApiRoute, token: String, body: String) = Unit
}
internal class RoomTestStore : RoomsStore {
    var commits = 0; var begins = 0; var clears = 0; var failClear = false
    var identity = RoomSyncIdentity(RoomId(OWN), RoomId(OTHER))
    var beforeCommit: suspend () -> Unit = {}
    var beforeBegin: suspend () -> Unit = {}
    var beforeClear: suspend () -> Unit = {}
    var pages = mutableListOf<MembershipPage>()
    override suspend fun begin(scope: RoomsAccountScope, validate: () -> Unit): RoomSyncIdentity {
        validate(); beforeBegin(); validate(); begins++; identity = RoomSyncIdentity(RoomId(OWN), RoomId(java.util.UUID.randomUUID().toString())); return identity
    }
    override suspend fun manifest(scope: RoomsAccountScope, identity: RoomSyncIdentity, requested: SyncCursor?, page: MembershipPage, validate: () -> Unit) {
        validate(); beforeCommit(); validate(); commits++; pages += page
    }
    override suspend fun discovery(scope: RoomsAccountScope, identity: RoomSyncIdentity, after: RoomId?, page: DiscoveryPage, validate: () -> Unit): RoomDirectory {
        validate(); beforeCommit(); validate(); commits++
        return RoomDirectory((pages.last() as MembershipPage.Success).rooms, page.rooms, page.next?.let { DiscoveryContinuation(identity.cacheId, it) }, identity.cacheId)
    }
    override suspend fun clear() { beforeClear(); clears++; if (failClear) throw RoomsStorageException(); pages.clear() }
}
internal fun NativeSessionCoordinator.roomsScope() = session.value.let { RoomsAccountScope(requireNotNull(it.account).id, it.generation, requireNotNull(it.accountPartition)) }

class RoomsSessionTest {
    @Test fun freshCompleteManifestIsRequiredBeforeDiscoveryAndMissingPartitionNeverFallsBackToUserId() = runTest {
        val api = RoomTestApi(); val db = RoomTestStore()
        val gateway = NativeSessionCoordinator(TestStore(), api, Clock.fixed(NOW, ZoneOffset.UTC), roomsStore = db)
        gateway.restore(); val result = gateway.refreshRooms(gateway.roomsScope()).getOrThrow()
        assertEquals(1, result.memberships.size); assertEquals(1, api.discoveryCalls)
        api.sessionJson = projection(); gateway.revalidate()
        assertNull(gateway.session.value.accountPartition)
        val stale = RoomsAccountScope(OWN, gateway.session.value.generation, PARTITION)
        assertTrue(runCatching { gateway.refreshRooms(stale) }.exceptionOrNull() is CancellationException)
        assertEquals(1, api.manifestCalls)
    }
    @Test fun resetRotatesCacheIdAndRestartsOnlyOnceWithoutReturningOldAuthority() = runTest {
        val api = RoomTestApi(); val requests = mutableListOf<ManifestRequest>()
        api.manifest = { requests += it; if (requests.size == 1) resetManifest else manifestJson() }
        val db = RoomTestStore(); val gateway = NativeSessionCoordinator(TestStore(), api, Clock.fixed(NOW, ZoneOffset.UTC), roomsStore = db)
        gateway.restore(); assertTrue(gateway.refreshRooms(gateway.roomsScope()).isSuccess)
        assertNotEquals(requests[0].cacheId, requests[1].cacheId); assertNull(requests[1].cursor)
        api.manifest = { resetManifest }
        assertTrue(gateway.refreshRooms(gateway.roomsScope()).exceptionOrNull() is RoomsResetRequired)
        assertEquals(1, api.discoveryCalls)
    }
    @Test fun linkRequiredDoesNotAdmitRoomHttp() = runTest {
        val api = RoomTestApi().apply { sessionJson = partitionProjection().replace("VERIFIED", "REQUIRED").replace("\"READY\"", "\"SOOP_LINK_REQUIRED\"").replace("\"chat\":true", "\"chat\":false") }
        val gateway = NativeSessionCoordinator(TestStore(), api, Clock.fixed(NOW, ZoneOffset.UTC), roomsStore = RoomTestStore())
        gateway.restore(); assertEquals(ShellAccess.LINK_REQUIRED, gateway.session.value.access)
        assertTrue(runCatching { gateway.refreshRooms(gateway.roomsScope()) }.exceptionOrNull() is CancellationException)
        assertEquals(0, api.manifestCalls)
    }
    @Test fun queuedOldScopeCannotIssueHttpAfterSameAccountEpochChange() = runTest {
        val api = RoomTestApi(); val gateway = NativeSessionCoordinator(TestStore(), api, Clock.fixed(NOW, ZoneOffset.UTC), roomsStore = RoomTestStore())
        gateway.restore(); val old = gateway.roomsScope()
        api.sessionJson = partitionProjection(generation = "h".repeat(43)); gateway.revalidate()
        assertTrue(runCatching { gateway.refreshRooms(old) }.exceptionOrNull() is CancellationException)
        assertEquals(0, api.manifestCalls)
        assertTrue(gateway.refreshRooms(gateway.roomsScope()).isSuccess)
    }
    @Test fun olderManifestAnd401CannotCommitOrEndNewPartitionScope() = runTest {
        for (unauthorized in listOf(false, true)) {
            val api = RoomTestApi(); val db = RoomTestStore(); val response = CompletableDeferred<String>()
            api.manifest = { withContext(NonCancellable) { response.await() }; if (unauthorized) throw ApiException(401, "UNAUTHENTICATED") else manifestJson() }
            val gateway = NativeSessionCoordinator(TestStore(), api, Clock.fixed(NOW, ZoneOffset.UTC), roomsStore = db)
            gateway.restore(); val old = gateway.roomsScope()
            val request = async { runCatching { gateway.refreshRooms(old) } }; runCurrent()
            api.sessionJson = partitionProjection(AccountPartition("D".repeat(42) + "A")); gateway.revalidate()
            response.complete("ready"); request.await()
            assertEquals(0, db.commits); assertEquals(ShellAccess.READY, gateway.session.value.access)
            assertNotEquals(old.partition, gateway.session.value.accountPartition)
        }
    }
    @Test fun concurrentRefreshDropsEarlierResponseWithinSameCredential() = runTest {
        val api = RoomTestApi(); val db = RoomTestStore(); val old = CompletableDeferred<Unit>()
        api.manifest = { if (api.manifestCalls == 1) withContext(NonCancellable) { old.await() }; manifestJson() }
        val gateway = NativeSessionCoordinator(TestStore(), api, Clock.fixed(NOW, ZoneOffset.UTC), roomsStore = db)
        gateway.restore(); val scope = gateway.roomsScope()
        val first = async { runCatching { gateway.refreshRooms(scope) } }; runCurrent()
        assertTrue(gateway.refreshRooms(scope).isSuccess); val commits = db.commits
        old.complete(Unit); first.await(); assertEquals(commits, db.commits); assertEquals(1, api.discoveryCalls)
    }
    @Test fun lifecycleWaitsThroughCommitThenPurgesBeforeSignedOutAndOldStoreCannotReturnData() = runTest {
        val api = RoomTestApi(); val db = RoomTestStore(); val commitGate = CompletableDeferred<Unit>()
        val entered = CompletableDeferred<Unit>(); db.beforeCommit = { entered.complete(Unit); commitGate.await() }
        val gateway = NativeSessionCoordinator(TestStore(), api, Clock.fixed(NOW, ZoneOffset.UTC), roomsStore = db)
        gateway.restore(); val request = async { runCatching { gateway.refreshRooms(gateway.roomsScope()) } }
        entered.await(); val logout = async { gateway.signOut() }; runCurrent()
        assertFalse(logout.isCompleted); commitGate.complete(Unit)
        logout.await(); request.await()
        assertEquals(ShellAccess.SIGNED_OUT, gateway.session.value.access); assertTrue(db.pages.isEmpty())
    }
    @Test fun expiryInjectedAfterWritesBeforeCommitRollsBackAndClearsSession() = runTest {
        var now = NOW
        val clock = object : Clock() { override fun instant() = now; override fun getZone() = ZoneOffset.UTC; override fun withZone(zone: ZoneId) = this }
        val api = RoomTestApi(); val db = RoomTestStore().apply { beforeCommit = { now = EXPIRY } }
        val gateway = NativeSessionCoordinator(TestStore(), api, clock, roomsStore = db)
        gateway.restore(); assertTrue(runCatching { gateway.refreshRooms(gateway.roomsScope()) }.exceptionOrNull() is CancellationException)
        assertEquals(0, db.commits); assertEquals(ShellAccess.SIGNED_OUT, gateway.session.value.access)
    }
    @Test fun partitionRotationHidesOldAccountBeforeAwaitingSlowDurablePurge() = runTest {
        val api = RoomTestApi(); val db = RoomTestStore()
        val gateway = NativeSessionCoordinator(TestStore(), api, Clock.fixed(NOW, ZoneOffset.UTC), roomsStore = db)
        gateway.restore(); gateway.refreshRooms(gateway.roomsScope()).getOrThrow()
        val gate = CompletableDeferred<Unit>(); val entered = CompletableDeferred<Unit>()
        db.beforeClear = { entered.complete(Unit); gate.await() }
        api.sessionJson = partitionProjection(AccountPartition("D".repeat(42) + "A"))
        val refresh = async { gateway.revalidate() }; entered.await()
        assertEquals(ShellAccess.RESTORING, gateway.session.value.access)
        assertNull(gateway.session.value.account); assertNull(gateway.session.value.accountPartition)
        gate.complete(Unit); assertTrue(refresh.await().isSuccess)
        assertEquals(ShellAccess.READY, gateway.session.value.access)
    }
    @Test fun failedPurgeStillClearsCredentialAndKeepsRetryableStorageState() = runTest {
        val credentials = TestStore(); val db = RoomTestStore(); val gateway = NativeSessionCoordinator(credentials, RoomTestApi(), Clock.fixed(NOW, ZoneOffset.UTC), roomsStore = db)
        gateway.restore(); db.failClear = true
        assertTrue(gateway.signOut().isFailure); assertNull(credentials.value)
        assertEquals(ShellAccess.RETRYABLE_FAILURE, gateway.session.value.access); assertTrue(gateway.session.value.storageFailure)
        db.failClear = false; assertTrue(gateway.resetLocalSession().isSuccess); assertEquals(ShellAccess.SIGNED_OUT, gateway.session.value.access)
    }
}
