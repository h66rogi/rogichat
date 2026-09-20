package chat.rogi.rogichat.core

import chat.rogi.rogichat.core.rooms.*
import chat.rogi.rogichat.feature.rooms.*
import kotlinx.coroutines.*
import kotlinx.coroutines.test.*
import org.junit.Assert.*
import org.junit.Test

class RoomsViewModelTest {
    private val scope = RoomsAccountScope(OWN, 1, PARTITION)
    private val empty = RoomDirectory(emptyList(), emptyList(), null, chat.rogi.rogichat.core.network.RoomId(OTHER))
    @Test fun realEmptyResponseAndFailureAreDifferentAndRetryUsesCapturedScope() = runTest {
        var failed = true
        var calls = 0
        val repository = object : RoomsRepository {
            override val roomCommands = kotlinx.coroutines.flow.MutableStateFlow(RoomCommandState())
            override suspend fun submitRoomCommand(intent: RoomCommandIntent) = error("unexpected")
            override suspend fun recheckRoomCommand(scope: RoomsAccountScope) = error("unexpected")
            override suspend fun refreshRooms(scope: RoomsAccountScope): Result<RoomDirectory> {
                assertEquals(this@RoomsViewModelTest.scope, scope); calls++
                return if (failed) Result.failure(IllegalStateException()) else Result.success(empty)
            }
            override suspend fun moreRooms(scope: RoomsAccountScope, continuation: DiscoveryContinuation) = error("unexpected")
        }
        val model = RoomsViewModel(repository, scope, backgroundScope)
        runCurrent(); assertNull(model.state.value.directory); assertNotNull(model.state.value.error)
        failed = false; model.reload(); runCurrent()
        assertEquals(empty, model.state.value.directory); assertNull(model.state.value.error); assertEquals(2, calls)
    }
    @Test fun oldNonCooperativeResponseCannotOverwriteNewRefreshOrClearedModel() = runTest {
        val old = CompletableDeferred<RoomDirectory>()
        var calls = 0
        val repository = object : RoomsRepository {
            override val roomCommands = kotlinx.coroutines.flow.MutableStateFlow(RoomCommandState())
            override suspend fun submitRoomCommand(intent: RoomCommandIntent) = error("unexpected")
            override suspend fun recheckRoomCommand(scope: RoomsAccountScope) = error("unexpected")
            override suspend fun refreshRooms(scope: RoomsAccountScope) = Result.success(if (++calls == 1) withContext(NonCancellable) { old.await() } else empty)
            override suspend fun moreRooms(scope: RoomsAccountScope, continuation: DiscoveryContinuation) = error("unexpected")
        }
        val model = RoomsViewModel(repository, scope, backgroundScope)
        runCurrent(); model.reload(); runCurrent()
        val owners = androidx.lifecycle.ViewModelStore().apply { put("rooms", model) }
        owners.clear(); old.complete(empty); runCurrent()
        assertNull(model.state.value.directory)
    }
    @Test fun loadMoreIsSingleFlightAndFailureDoesNotDiscardConfirmedMemberships() = runTest {
        val continuation = DiscoveryContinuation(chat.rogi.rogichat.core.network.RoomId(OTHER), chat.rogi.rogichat.core.network.RoomId(ROOM))
        val loaded = empty.copy(continuation = continuation)
        val gate = CompletableDeferred<Unit>(); var calls = 0
        val repository = object : RoomsRepository {
            override val roomCommands = kotlinx.coroutines.flow.MutableStateFlow(RoomCommandState())
            override suspend fun submitRoomCommand(intent: RoomCommandIntent) = error("unexpected")
            override suspend fun recheckRoomCommand(scope: RoomsAccountScope) = error("unexpected")
            override suspend fun refreshRooms(scope: RoomsAccountScope) = Result.success(loaded)
            override suspend fun moreRooms(scope: RoomsAccountScope, continuation: DiscoveryContinuation): Result<RoomDirectory> {
                calls++; gate.await(); return Result.failure(IllegalStateException())
            }
        }
        val model = RoomsViewModel(repository, scope, backgroundScope); runCurrent()
        model.more(); model.more(); runCurrent(); assertEquals(1, calls)
        gate.complete(Unit); runCurrent(); assertEquals(loaded, model.state.value.directory); assertNotNull(model.state.value.error)
    }
}
