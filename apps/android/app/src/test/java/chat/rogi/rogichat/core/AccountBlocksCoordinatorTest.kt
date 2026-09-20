package chat.rogi.rogichat.core

import chat.rogi.rogichat.core.messageactions.*
import chat.rogi.rogichat.core.network.*
import chat.rogi.rogichat.core.rooms.*
import chat.rogi.rogichat.core.session.*
import chat.rogi.rogichat.core.media.*
import java.io.IOException
import java.util.UUID
import kotlinx.coroutines.*
import kotlinx.coroutines.test.*
import org.junit.Assert.*
import org.junit.Test

internal class BlockStore : AccountFeatureStore {
    val records = mutableListOf<UnblockRecord>(); var failWrite = false; var failCommitOnce = false
    override suspend fun prepareAccount(scope: RoomsAccountScope, binding: String, generation: String, validate: () -> Unit) = validate()
    override suspend fun <T> blockTransaction(scope: RoomsAccountScope, validate: () -> Unit, operation: (BlockJournal, ActionJournal) -> T): T {
        validate()
        val journal = object : BlockJournal {
            override fun records() = records.toList()
            override fun put(record: UnblockRecord) { if (failWrite) throw IOException(); records.removeAll { it.id == record.id }; records += record }
        }
        val previous = records.toList()
        try {
            val result = operation(journal, object : ActionJournal { override fun records() = emptyList<ActionRecord>(); override fun put(record: ActionRecord) = error("unexpected") })
            if (failCommitOnce) { failCommitOnce = false; throw IOException("commit failed") }
            validate(); return result
        } catch (failure: Throwable) { records.clear(); records.addAll(previous); throw failure }
    }
    override suspend fun accountMedia(scope: RoomsAccountScope, validate: () -> Unit) = emptyList<PendingMedia>()
    override suspend fun accountMedia(scope: RoomsAccountScope, pending: PendingMedia, validate: () -> Unit) = error("unexpected")
    override suspend fun removeAccountMedia(scope: RoomsAccountScope, assetId: String, validate: () -> Unit) = error("unexpected")
}
private class BlocksApi : NativeApi {
    var delete = 0; var list = 0; var rooms = 0
    var roomPage: (ActionRequest) -> String = { """{"rooms":[{"roomId":"$OTHER","displayName":"현재 대화"}],"nextCursor":null}""" }
    var beforeDelete: suspend () -> Unit = {}
    var deletion: () -> NativeResponse = { throw IOException("lost response") }
    override suspend fun messageActionAdmitted(token: String, request: ActionRequest, admission: () -> Unit): NativeResponse {
        if (request.method == "DELETE") beforeDelete()
        admission()
        return when {
            request.path == "blocked-rooms" -> { rooms++; NativeResponse(200, roomPage(request)) }
            request.method == "DELETE" -> { delete++; deletion() }
            else -> { list++; NativeResponse(200, """{"blocks":[{"actorId":"$OWN","blockedAt":"2026-09-20T00:00:00Z","displayName":"현재 사용자"}],"next":null}""") }
        }
    }
    override suspend fun get(route: ApiRoute, token: String) = error("unexpected")
    override suspend fun patch(route: ApiRoute, token: String, body: String) = error("unexpected")
    override suspend fun postWithoutResponse(route: ApiRoute, token: String, body: String) = error("unexpected")
}
private class BlocksGateway(private val api: NativeApi) : AccountFeatureGateway {
    var valid = true; var resets = 0
    private fun check() { if (!valid) throw CancellationException("account_changed") }
    override suspend fun admitAccountFeature(expected: SessionIdentity) = AccountFeaturePermit(RoomsAccountScope(OWN, 1, AccountPartition("A".repeat(43))), UUID.randomUUID().toString(), Any(), ::check)
    override suspend fun <T> accountFeatureRequest(permit: AccountFeaturePermit, operation: suspend (NativeApi, String, () -> Unit) -> T): T { check(); return operation(api, TOKEN, ::check).also { check() } }
    override suspend fun <T> accountFeatureCommit(permit: AccountFeaturePermit, operation: suspend (() -> Unit) -> T): T { check(); return operation(::check).also { check() } }
    override suspend fun accountBlocksChanged(permit: AccountFeaturePermit) { check(); resets++ }
    override suspend fun accountProfileRequest(permit: AccountFeaturePermit, operation: suspend (NativeApi, String, () -> Unit) -> String): String = error("unexpected")
}
@OptIn(ExperimentalCoroutinesApi::class)
class AccountBlocksCoordinatorTest {
    @Test fun emptyOpaquePrefixContinuesAndLoopDropsAllPriorNames() = runTest {
        val api = BlocksApi(); val gateway = BlocksGateway(api); val model = AccountBlocksCoordinator(gateway, BlockStore(), backgroundScope, "qa")
        api.roomPage = { if (it.query.isEmpty()) """{"rooms":[],"nextCursor":"opaque-next"}""" else """{"rooms":[{"roomId":"$OTHER","displayName":null}],"nextCursor":null}""" }
        val handle = model.open(SessionIdentity(1, OWN)); runCurrent()
        assertEquals(2, api.rooms); assertEquals("이름을 확인할 수 없는 대화", handle.state.value.rooms.single().label)
        api.roomPage = { """{"rooms":[],"nextCursor":"loop"}""" }; model.rooms(handle); runCurrent()
        assertNotNull(handle.state.value.error); assertTrue(handle.state.value.rooms.isEmpty())
    }
    @Test fun staleRenderedRoomCycleCannotSelectARefreshedRoom() = runTest {
        val api = BlocksApi(); val model = AccountBlocksCoordinator(BlocksGateway(api), BlockStore(), backgroundScope, "qa")
        val handle = model.open(SessionIdentity(1, OWN)); runCurrent(); val old = handle.state.value
        model.rooms(handle); runCurrent(); model.select(handle, old.roomCycle, old.rooms.single()); runCurrent()
        assertEquals(0, api.list)
        val fresh = handle.state.value; model.select(handle, fresh.roomCycle, fresh.rooms.single()); runCurrent(); assertEquals(1, api.list)
    }
    @Test fun unknownUnblockIsCommittedBeforeSingleDeleteAndFreshGetDoesNotClaimSuccess() = runTest {
        val api = BlocksApi(); val store = BlockStore(); val gateway = BlocksGateway(api)
        val model = AccountBlocksCoordinator(gateway, store, backgroundScope, "qa")
        val handle = model.open(SessionIdentity(1, OWN)); runCurrent(); val rooms = handle.state.value
        model.select(handle, rooms.roomCycle, rooms.rooms.single()); runCurrent()
        api.beforeDelete = { assertEquals(UnblockOutcome.UNKNOWN, store.records.single().outcome) }
        model.unblock(handle, requireNotNull(handle.state.value.token), OWN); runCurrent()
        assertEquals(1, api.delete); assertEquals(2, api.list)
        assertEquals(UnblockOutcome.UNKNOWN, store.records.single().outcome); assertEquals(true, store.records.single().observedBlocked)
        assertEquals(UnblockOutcome.UNKNOWN, handle.state.value.outcome)
        model.refresh(handle); runCurrent(); assertEquals(1, api.delete)
    }
    @Test fun scopeClosedInTransportQueueDoesNotSendOrLoseOriginalUnknownJournal() = runTest {
        val api = BlocksApi(); val store = BlockStore(); val gateway = BlocksGateway(api)
        val model = AccountBlocksCoordinator(gateway, store, backgroundScope, "qa")
        val handle = model.open(SessionIdentity(1, OWN)); runCurrent(); val rooms = handle.state.value
        model.select(handle, rooms.roomCycle, rooms.rooms.single()); runCurrent()
        val entered = CompletableDeferred<Unit>(); val release = CompletableDeferred<Unit>()
        api.beforeDelete = { entered.complete(Unit); release.await() }
        model.unblock(handle, requireNotNull(handle.state.value.token), OWN); runCurrent(); entered.await()
        gateway.valid = false; model.invalidate(); release.complete(Unit); runCurrent()
        assertEquals(0, api.delete); assertEquals(UnblockOutcome.UNKNOWN, store.records.single().outcome)
        assertTrue(handle.state.value.blocks.isEmpty()); assertTrue(handle.state.value.rooms.isEmpty())
    }
    @Test fun resultPersistenceFailureReleasesOnlyDispatchAndAllowsGetOnlyRecovery() = runTest {
        val api = BlocksApi(); val store = BlockStore(); val model = AccountBlocksCoordinator(BlocksGateway(api), store, backgroundScope, "qa")
        val handle = model.open(SessionIdentity(1, OWN)); runCurrent(); val rooms = handle.state.value
        model.select(handle, rooms.roomCycle, rooms.rooms.single()); runCurrent()
        api.deletion = { store.failCommitOnce = true; NativeResponse(200, """{"actorId":"$OWN","blocked":false,"resetRequired":true}""") }
        model.unblock(handle, requireNotNull(handle.state.value.token), OWN); runCurrent()
        assertEquals(1, api.delete); assertNotNull(handle.state.value.error)
        assertEquals(UnblockOutcome.UNKNOWN, store.records.single().outcome)
        model.refresh(handle); runCurrent()
        assertEquals(2, api.list); assertEquals(1, api.delete)
        assertEquals(UnblockOutcome.UNKNOWN, handle.state.value.outcome)
        assertEquals(setOf(OWN), handle.state.value.unknownActors)
        assertEquals(true, store.records.single().observedBlocked)
        val reopened = model.open(SessionIdentity(1, OWN)); runCurrent(); val current = reopened.state.value
        model.select(reopened, current.roomCycle, current.rooms.single()); runCurrent()
        assertEquals(3, api.list); assertEquals(1, api.delete)
        assertEquals(setOf(OWN), reopened.state.value.unknownActors)
        assertEquals(UnblockOutcome.UNKNOWN, store.records.single().outcome)
    }
    @Test fun enqueueCommitRollbackDoesNotKeepGhostDispatchOrSendDelete() = runTest {
        val api = BlocksApi(); val store = BlockStore(); val model = AccountBlocksCoordinator(BlocksGateway(api), store, backgroundScope, "qa")
        val handle = model.open(SessionIdentity(1, OWN)); runCurrent(); val rooms = handle.state.value
        model.select(handle, rooms.roomCycle, rooms.rooms.single()); runCurrent(); store.failCommitOnce = true
        model.unblock(handle, requireNotNull(handle.state.value.token), OWN); runCurrent()
        assertEquals(0, api.delete); assertNotNull(handle.state.value.error); assertTrue(store.records.isEmpty())
        model.refresh(handle); runCurrent()
        assertEquals(2, api.list); assertEquals(0, api.delete); assertTrue(store.records.isEmpty())
        assertTrue(handle.state.value.complete); assertTrue(handle.state.value.unknownActors.isEmpty()); assertNull(handle.state.value.outcome)
    }
    @Test fun journalFailurePreventsDeleteAndStrictDirectoryRejectsMalformedNames() = runTest {
        val api = BlocksApi(); val store = BlockStore(); val model = AccountBlocksCoordinator(BlocksGateway(api), store, backgroundScope, "qa")
        val handle = model.open(SessionIdentity(1, OWN)); runCurrent(); val rooms = handle.state.value
        model.select(handle, rooms.roomCycle, rooms.rooms.single()); runCurrent(); store.failWrite = true
        model.unblock(handle, requireNotNull(handle.state.value.token), OWN); runCurrent()
        assertEquals(0, api.delete); assertNotNull(handle.state.value.error)
        assertTrue(runCatching { BlockedRoomsWire.page("""{"rooms":[{"roomId":"$OWN"}],"nextCursor":null}""") }.isFailure)
        assertTrue(runCatching { BlockedRoomsWire.page("""{"rooms":[{"roomId":"$OWN","displayName":4}],"nextCursor":null}""") }.isFailure)
        assertTrue(runCatching { BlockedRoomsWire.request("A".repeat(2201)) }.isFailure)
    }
}
