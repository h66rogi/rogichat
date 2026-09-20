package chat.rogi.rogichat.core

import chat.rogi.rogichat.core.conversation.*
import chat.rogi.rogichat.core.network.*
import chat.rogi.rogichat.core.navigation.ShellAccess
import chat.rogi.rogichat.core.session.*
import chat.rogi.rogichat.core.rooms.*
import kotlinx.coroutines.*
import kotlinx.coroutines.test.*
import org.junit.Assert.*
import org.junit.Test
import java.time.*

@OptIn(ExperimentalCoroutinesApi::class)
class ConversationGatewayTest {
    @Test fun oldDirectoryAndSameAccountNewEpochCannotAcquireOrUseConversationPermit() = runTest {
        val api = RoomTestApi(); val store = TestStore()
        val gateway = NativeSessionCoordinator(store, api, Clock.fixed(NOW, ZoneOffset.UTC), roomsStore = RoomTestStore())
        gateway.restore().getOrThrow(); val scope = gateway.roomsScope(); val directory = gateway.refreshRooms(scope).getOrThrow()
        val selection = ConversationSelection(scope, directory.memberships.single(), directory.cycle)
        val permit = gateway.admitConversation(selection)
        var calls = 0
        gateway.conversationRequest(permit) { _, token -> assertEquals(TOKEN, token); calls++ }
        api.sessionJson = partitionProjection(generation = "h".repeat(43)); gateway.revalidate().getOrThrow()
        assertTrue(runCatching { gateway.admitConversation(selection) }.exceptionOrNull() is CancellationException)
        assertTrue(runCatching { gateway.conversationRequest(permit) { _, _ -> calls++ } }.exceptionOrNull() is CancellationException)
        assertEquals(1, calls); assertEquals(TOKEN, store.value!!.token)
    }
    @Test fun delayedOld401CannotClearNewScopeOrReturnPrivateResponse() = runTest {
        for (unauthorized in listOf(false, true)) {
            val api = RoomTestApi(); val credentials = TestStore()
            val gateway = NativeSessionCoordinator(credentials, api, Clock.fixed(NOW, ZoneOffset.UTC), roomsStore = RoomTestStore())
            gateway.restore(); val scope = gateway.roomsScope(); val directory = gateway.refreshRooms(scope).getOrThrow()
            val permit = gateway.admitConversation(ConversationSelection(scope, directory.memberships.single(), directory.cycle))
            val response = CompletableDeferred<Unit>()
            val pending = async { runCatching { gateway.conversationRequest(permit) { _, _ ->
                withContext(NonCancellable) { response.await() }
                if (unauthorized) throw ApiException(401, "UNAUTHENTICATED") else "private response"
            } } }
            runCurrent(); api.sessionJson = partitionProjection(generation = "h".repeat(43)); gateway.revalidate()
            val after = gateway.session.value; response.complete(Unit)
            assertTrue(pending.await().isFailure); assertEquals(after, gateway.session.value)
            assertEquals(TOKEN, credentials.value!!.token); assertEquals(ShellAccess.READY, gateway.session.value.access)
        }
    }
    @Test fun expiryDuringStorageValidationRollsBackAndDurablyEndsOnlyOriginalSession() = runTest {
        var now = NOW
        val clock = object : Clock() { override fun instant() = now; override fun getZone() = ZoneOffset.UTC; override fun withZone(zone: ZoneId) = this }
        val credentials = TestStore(); val api = RoomTestApi()
        val gateway = NativeSessionCoordinator(credentials, api, clock, roomsStore = RoomTestStore())
        gateway.restore(); val scope = gateway.roomsScope(); val directory = gateway.refreshRooms(scope).getOrThrow()
        val permit = gateway.admitConversation(ConversationSelection(scope, directory.memberships.single(), directory.cycle))
        var committed = false
        assertTrue(runCatching { gateway.conversationCommit(permit) { validate ->
            now = EXPIRY; validate(); committed = true
        } }.exceptionOrNull() is CancellationException)
        assertFalse(committed); assertNull(credentials.value); assertEquals(ShellAccess.SIGNED_OUT, gateway.session.value.access)
    }
    @Test fun retryAfterTemporaryRestoreFailureWithdrawsAuthorityWithoutPurgingOriginalOutbox() = runTest {
        val directory = RoomTestStore(); val contents = ConversationMemory()
        var authorizations = 0; var withdrawals = 0
        val storage = object : RoomsStore by directory, ConversationStore by contents {
            override suspend fun authorize(scope: RoomsAccountScope, credentialBinding: String, serverGeneration: String, validate: () -> Unit) {
                validate(); authorizations++
            }
            override suspend fun withdrawAuthority() { withdrawals++ }
        }
        val base = RoomTestApi(); var unavailable = false
        val api = object : NativeApi by base {
            override suspend fun get(route: ApiRoute, token: String): String {
                if (unavailable) throw java.io.IOException("offline")
                return base.get(route, token)
            }
        }
        val gateway = NativeSessionCoordinator(TestStore(), api, Clock.fixed(NOW, ZoneOffset.UTC), roomsStore = storage)
        gateway.restore().getOrThrow()
        assertEquals(0, directory.clears); assertEquals(1, authorizations)
        unavailable = true; assertTrue(gateway.restore().isFailure)
        assertEquals(ShellAccess.RETRYABLE_FAILURE, gateway.session.value.access); assertNull(gateway.session.value.account)
        unavailable = false; gateway.restore().getOrThrow()
        assertEquals(ShellAccess.READY, gateway.session.value.access)
        assertEquals(0, directory.clears); assertEquals(2, authorizations); assertTrue(withdrawals >= 2)
        gateway.signOut().getOrThrow(); assertEquals(1, directory.clears)
    }

}
