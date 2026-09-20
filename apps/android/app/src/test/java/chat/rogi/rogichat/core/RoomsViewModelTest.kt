package chat.rogi.rogichat.core

import chat.rogi.rogichat.feature.rooms.*
import kotlinx.coroutines.runBlocking
import kotlinx.coroutines.yield
import org.junit.Assert.*
import org.junit.Test

class RoomsViewModelTest {
    @Test fun realEmptyResponseAndFailureAreDifferentStatesAndRetryUsesRepository() = runBlocking {
        var failed = true
        var calls = 0
        val repository = object : RoomsRepository {
            override suspend fun list(accountId: String): Result<List<RoomSummary>> {
                assertEquals("account", accountId)
                calls++
                return if (failed) Result.failure(IllegalStateException()) else Result.success(emptyList())
            }
        }
        val model = RoomsViewModel(repository, "account", this)
        yield()
        assertEquals(RoomsState.Failed, model.state.value)
        failed = false
        model.reload()
        yield()
        assertEquals(RoomsState.Loaded(emptyList()), model.state.value)
        assertEquals(2, calls)
    }
}
