package chat.rogi.rogichat.core

import chat.rogi.rogichat.core.navigation.ShellAccess
import chat.rogi.rogichat.core.session.*
import chat.rogi.rogichat.feature.rooms.RoomsViewModel
import java.io.IOException
import java.time.Clock
import java.time.ZoneOffset
import kotlinx.coroutines.*
import kotlinx.coroutines.test.*
import org.junit.Assert.*
import org.junit.Test

/** The READY account-check fallback is separate from an admitted room repository retry. */
@OptIn(ExperimentalCoroutinesApi::class)
class ReadyRoomRetryTest {
    @Test fun readyWithoutPartitionRetryFetchesAccountOnceThenFailedRoomsRetryLoadsActualRepository() = runTest {
        val api = RoomTestApi().apply { sessionJson = projection() }
        val gateway = NativeSessionCoordinator(TestStore(), api, Clock.fixed(NOW, ZoneOffset.UTC), roomsStore = RoomTestStore())
        gateway.restore().getOrThrow()
        assertEquals(ShellAccess.READY, gateway.session.value.access)
        assertNull(gateway.session.value.accountPartition)
        val model = SessionViewModel(gateway.services(), backgroundScope)
        val rendered = SessionIdentity.from(gateway.session.value)
        api.sessionJson = partitionProjection()
        model.retryValidation(rendered); model.retryValidation(rendered); runCurrent()
        assertEquals(2, api.sessionCalls) // Initial restore + exactly one actual retry.
        assertEquals(PARTITION, gateway.session.value.accountPartition)
        assertFalse(model.state.value.busy); assertNull(model.state.value.error)

        api.manifest = { throw IOException("offline") }
        val rooms = RoomsViewModel(gateway, gateway.roomsScope(), backgroundScope); runCurrent()
        assertNotNull(rooms.state.value.error); assertNull(rooms.state.value.directory)
        api.manifest = { manifestJson() }
        rooms.reload(); runCurrent()
        assertEquals(2, api.manifestCalls); assertEquals(1, api.discoveryCalls)
        assertEquals(1, rooms.state.value.directory?.memberships?.size)
        assertNull(rooms.state.value.error)
    }

    @Test fun oldRenderedRetryCannotRebindAfterSameAccountEpochChanges() = runTest {
        val api = RoomTestApi().apply { sessionJson = projection() }
        val gateway = NativeSessionCoordinator(TestStore(), api, Clock.fixed(NOW, ZoneOffset.UTC), roomsStore = RoomTestStore())
        gateway.restore().getOrThrow()
        val model = SessionViewModel(gateway.services(), backgroundScope)
        val rendered = SessionIdentity.from(gateway.session.value)
        api.sessionJson = partitionProjection(generation = "h".repeat(43)); gateway.revalidate().getOrThrow()
        val calls = api.sessionCalls
        model.retryValidation(rendered); runCurrent()
        assertEquals(calls, api.sessionCalls); assertFalse(model.state.value.busy)
    }

    @Test fun queuedRetryPreservesOriginalIdentityAcrossServiceHop() = runTest {
        val api = RoomTestApi().apply { sessionJson = projection() }
        val gateway = NativeSessionCoordinator(TestStore(), api, Clock.fixed(NOW, ZoneOffset.UTC), roomsStore = RoomTestStore())
        gateway.restore().getOrThrow()
        val gate = CompletableDeferred<Unit>()
        val actions = object : SessionActions by gateway {
            override suspend fun revalidate(expected: SessionIdentity?): Result<Unit> {
                gate.await(); return gateway.revalidate(expected)
            }
        }
        val model = SessionViewModel(ProductServices(gateway.session, actions), backgroundScope)
        model.retryValidation(SessionIdentity.from(gateway.session.value)); runCurrent()
        assertTrue(model.state.value.busy)
        api.sessionJson = partitionProjection(generation = "h".repeat(43)); gateway.revalidate().getOrThrow()
        val calls = api.sessionCalls
        gate.complete(Unit); runCurrent()
        assertEquals(calls, api.sessionCalls); assertFalse(model.state.value.busy)
        assertNull(model.state.value.error); assertEquals(PARTITION, gateway.session.value.accountPartition)
    }

    @Test fun cancellationReleasesRetryBusyWithoutReplacingReadyAccount() = runTest {
        val api = RoomTestApi().apply { sessionJson = projection() }
        val gateway = NativeSessionCoordinator(TestStore(), api, Clock.fixed(NOW, ZoneOffset.UTC), roomsStore = RoomTestStore())
        gateway.restore().getOrThrow()
        val before = gateway.session.value
        val entered = CompletableDeferred<Unit>(); val uiJob = SupervisorJob()
        val actions = object : SessionActions by gateway {
            override suspend fun revalidate(expected: SessionIdentity?): Result<Unit> { entered.complete(Unit); awaitCancellation() }
        }
        val model = SessionViewModel(ProductServices(gateway.session, actions), CoroutineScope(uiJob + StandardTestDispatcher(testScheduler)))
        model.retryValidation(SessionIdentity.from(before)); runCurrent(); entered.await()
        uiJob.cancel(); runCurrent()
        assertFalse(model.state.value.busy); assertNull(model.state.value.error)
        assertEquals(before, gateway.session.value); assertEquals(1, api.sessionCalls)
    }
}
