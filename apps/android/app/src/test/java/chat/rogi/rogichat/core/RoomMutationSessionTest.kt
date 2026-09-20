package chat.rogi.rogichat.core

import androidx.lifecycle.ViewModelStore
import chat.rogi.rogichat.core.navigation.ShellAccess
import chat.rogi.rogichat.core.auth.*
import chat.rogi.rogichat.core.network.*
import chat.rogi.rogichat.core.rooms.*
import chat.rogi.rogichat.core.session.*
import chat.rogi.rogichat.feature.rooms.RoomsViewModel
import java.io.IOException
import java.time.*
import kotlinx.coroutines.*
import kotlinx.coroutines.test.*
import kotlinx.coroutines.flow.collect
import org.junit.Assert.*
import org.junit.Test

private class RoomMutationFixture(owner: CoroutineScope, clock: Clock = Clock.fixed(NOW, ZoneOffset.UTC)) {
    val api = RoomTestApi()
    val db = RoomTestStore()
    val credentials = TestStore()
    private var pending: PendingAuth? = null
    private var proofs = 0
    private val pendingStore = object : PendingAuthStore {
        override suspend fun read() = pending
        override suspend fun write(value: PendingAuth) { pending = value }
        override suspend fun clear() { pending = null }
    }
    private val auth = SoopAuthSupport(SoopAuthContract("qa"), pendingStore) {
        val ordinal = ++proofs
        AuthProof(fingerprint("rooms-verifier-$ordinal"), fingerprint("rooms-state-$ordinal"))
    }
    val gateway = NativeSessionCoordinator(credentials, api, clock, auth, roomsStore = db, roomCommandScope = owner)
    lateinit var scope: RoomsAccountScope
    lateinit var directory: RoomDirectory
    suspend fun start() { gateway.restore().getOrThrow(); scope = gateway.roomsScope(); directory = gateway.refreshRooms(scope).getOrThrow() }
    suspend fun loginAs(account: String, token: String) {
        gateway.signOut().getOrThrow()
        val partition = if (account == OWN) PARTITION else AccountPartition("D".repeat(42) + "A")
        api.sessionJson = partitionProjection(partition).replace("\"userId\":\"$OWN\"", "\"userId\":\"$account\"")
        api.authResponse = { route -> when (route) {
            ApiRoute.SOOP_START -> """{"transactionId":"00000000-0000-4000-8000-000000000007","authorizeUrl":"https://api.qa.rogi.chat/v1/auth/native/soop/launch?request=${"r".repeat(43)}","expiresIn":600}"""
            ApiRoute.SOOP_EXCHANGE -> """{"tokenType":"Bearer","accessToken":"$token","expiresAt":"$EXPIRY","session":${api.sessionJson}}"""
            else -> error("unexpected")
        } }
        gateway.startLogin(CURRENT_TERMS).getOrThrow()
        val state = requireNotNull(pending).proof.state
        gateway.handleCallback("https://qa.rogi.chat/mobile/auth/complete?code=${"c".repeat(43)}&state=$state").getOrThrow()
        assertEquals(token, credentials.value!!.token); assertEquals(account, gateway.session.value.account!!.id)
        scope = gateway.roomsScope(); directory = gateway.refreshRooms(scope).getOrThrow()
    }
    fun intent(action: RoomAction = RoomAction.JOIN) = RoomCommandIntent(scope,
        RoomId(if (action == RoomAction.JOIN) ROOM_TWO else ROOM), action, directory.cycle,
        if (action == RoomAction.LEAVE) MEMBERSHIP else null)
}
private suspend fun TestScope.mutationFixture(clock: Clock = Clock.fixed(NOW, ZoneOffset.UTC)) =
    RoomMutationFixture(backgroundScope, clock).also { it.start() }

@OptIn(ExperimentalCoroutinesApi::class)
class RoomMutationSessionTest {
    @Test fun joinInvalidatesBeforePostAndOnlyCompleteManifestPublishesAllRoomAuthorization() = runTest {
        val f = mutationFixture()
        val revised = RoomScopeToken("D".repeat(42) + "A")
        f.api.join = { token, room ->
            assertEquals(TOKEN, token); assertEquals(ROOM_TWO, room.value); assertEquals(2, f.db.begins)
            f.api.manifest = { manifestJson("${roomJson()},${roomJson(ROOM_TWO)}".replace(AUTHORIZATION.value, revised.value)) }
            joinJson()
        }
        assertTrue(f.gateway.submitRoomCommand(f.intent()).isSuccess)
        assertEquals(RoomCommandPhase.SENDING, f.gateway.roomCommands.value.phase)
        runCurrent()
        val state = f.gateway.roomCommands.value
        assertEquals(RoomCommandPhase.VERIFIED, state.phase); assertNull(state.issue)
        assertEquals(2, state.directory!!.memberships.size)
        assertTrue(state.directory.memberships.all { it.authorizationRevision == revised })
        assertEquals(1, f.api.joins); assertEquals(2, f.api.manifestCalls)
    }
    @Test fun sessionOwnsSingleFlightAcrossViewModelClearRecreationAndCompetingReads() = runTest {
        val f = mutationFixture(); val gate = CompletableDeferred<Unit>()
        f.api.join = { _, _ -> gate.await(); joinJson() }
        f.gateway.submitRoomCommand(f.intent()); runCurrent()
        val first = RoomsViewModel(f.gateway, f.scope, backgroundScope); runCurrent()
        ViewModelStore().apply { put("rooms", first); clear() }
        val replacement = RoomsViewModel(f.gateway, f.scope, backgroundScope); runCurrent()
        assertTrue(replacement.state.value.command!!.busy)
        assertTrue(f.gateway.submitRoomCommand(f.intent()).exceptionOrNull() is RoomCommandInProgress)
        assertTrue(f.gateway.refreshRooms(f.scope).exceptionOrNull() is RoomCommandInProgress)
        assertTrue(f.gateway.moreRooms(f.scope, DiscoveryContinuation(f.directory.cycle, RoomId(ROOM_TWO))).exceptionOrNull() is RoomCommandInProgress)
        assertEquals(1, f.api.manifestCalls); assertEquals(1, f.api.joins)
        gate.complete(Unit); runCurrent()
        assertEquals(RoomCommandPhase.VERIFIED, replacement.state.value.command!!.phase)
        assertEquals(1, f.api.joins)
    }
    @Test fun oldAccountAndAToBToAScopesNeverSendQueuedCommand() = runTest {
        val f = mutationFixture(); val old = f.intent()
        f.loginAs(OTHER, fingerprint("rooms-account-b"))
        assertEquals(OTHER, f.gateway.session.value.account!!.id)
        assertTrue(runCatching { f.gateway.submitRoomCommand(old) }.exceptionOrNull() is CancellationException)
        f.loginAs(OWN, fingerprint("rooms-account-a-return"))
        assertEquals(OWN, f.gateway.session.value.account!!.id); assertNotEquals(TOKEN, f.credentials.value!!.token)
        assertTrue(runCatching { f.gateway.submitRoomCommand(old) }.exceptionOrNull() is CancellationException)
        assertEquals(0, f.api.joins)
    }
    @Test fun sameBearerAccountMismatchFailsClosedAndCannotAdmitTheOldRoomIntent() = runTest {
        val f = mutationFixture(); val old = f.intent()
        f.api.sessionJson = partitionProjection().replace("\"userId\":\"$OWN\"", "\"userId\":\"$OTHER\"")
        assertTrue(f.gateway.revalidate().exceptionOrNull() is InvalidResponse)
        assertEquals(ShellAccess.RETRYABLE_FAILURE, f.gateway.session.value.access)
        assertNull(f.gateway.session.value.account)
        assertTrue(runCatching { f.gateway.submitRoomCommand(old) }.exceptionOrNull() is CancellationException)
        assertEquals(0, f.api.joins)
    }
    @Test fun refreshedCycleOrChangedSelectedMembershipRequiresNewUserConfirmation() = runTest {
        val f = mutationFixture(); val old = f.intent(RoomAction.LEAVE)
        val fresh = f.gateway.refreshRooms(f.scope).getOrThrow()
        assertTrue(f.gateway.submitRoomCommand(old).exceptionOrNull() is StaleRoomSelection)
        val wrongM = old.copy(cycle = fresh.cycle, membership = RoomScopeToken("D".repeat(42) + "A"))
        assertTrue(f.gateway.submitRoomCommand(wrongM).exceptionOrNull() is StaleRoomSelection)
        assertEquals(0, f.api.leaves)
    }
    @Test fun unknownPostThenGetDoesNotProveTerminationAndLateServerCommitNeedsAnotherRead() = runTest {
        val f = mutationFixture()
        f.api.join = { _, _ -> throw IOException("isolated_lost_response") }
        f.gateway.submitRoomCommand(f.intent()); runCurrent()
        assertEquals(RoomCommandIssue.UNKNOWN, f.gateway.roomCommands.value.issue)
        assertEquals(listOf(ROOM), f.gateway.roomCommands.value.directory!!.memberships.map { it.roomId.value })
        assertEquals(1, f.api.joins)
        // The timed-out original command can commit on the server AFTER this reconciliation GET.
        f.api.manifest = { manifestJson("${roomJson()},${roomJson(ROOM_TWO)}") }
        val now = f.gateway.refreshRooms(f.scope).getOrThrow()
        assertEquals(2, now.memberships.size); assertEquals(1, f.api.joins)
        assertEquals(RoomCommandIssue.UNKNOWN, f.gateway.roomCommands.value.issue) // no causal success/failure claim.
    }
    @Test fun failedReconciliationOnlyOffersGetAndExplicitNewChoiceRequiresCompleteState() = runTest {
        val f = mutationFixture()
        f.api.join = { _, _ -> f.db.beforeBegin = { throw RoomsStorageException() }; throw IOException() }
        f.gateway.submitRoomCommand(f.intent()); runCurrent()
        assertEquals(RoomCommandPhase.UNVERIFIED, f.gateway.roomCommands.value.phase)
        assertEquals(RoomCommandIssue.UNKNOWN, f.gateway.roomCommands.value.issue)
        assertEquals(RoomVerificationIssue.STORAGE, f.gateway.roomCommands.value.verificationIssue)
        assertTrue(f.gateway.submitRoomCommand(f.intent()).exceptionOrNull() is RoomCommandInProgress)
        assertTrue(f.gateway.refreshRooms(f.scope).exceptionOrNull() is RoomCommandInProgress)
        f.db.beforeBegin = {}; f.api.manifest = { manifestJson() }
        assertTrue(f.gateway.recheckRoomCommand(f.scope).isSuccess); runCurrent()
        assertEquals(RoomCommandPhase.VERIFIED, f.gateway.roomCommands.value.phase); assertEquals(1, f.api.joins)
        val newChoice = f.intent().copy(cycle = f.gateway.roomCommands.value.directory!!.cycle)
        f.api.join = { _, _ -> joinJson() }
        f.gateway.submitRoomCommand(newChoice); runCurrent(); assertEquals(2, f.api.joins)
    }
    @Test fun ownerConflictPreservesMembershipAndHasNoSuccessOrPostReplay() = runTest {
        val f = mutationFixture(); f.api.leave = { _, _ -> throw ApiException(409, "CONFLICT") }
        f.gateway.submitRoomCommand(f.intent(RoomAction.LEAVE)); runCurrent()
        assertEquals(RoomCommandIssue.CONFLICT, f.gateway.roomCommands.value.issue)
        assertEquals(listOf(ROOM), f.gateway.roomCommands.value.directory!!.memberships.map { it.roomId.value })
        assertEquals(1, f.api.leaves); assertEquals(ShellAccess.READY, f.gateway.session.value.access)
    }
    @Test fun leave204WaitsForCompleteEmptyAndKeepsOldRowsWhileManifestIsPending() = runTest {
        val f = mutationFixture(); val gate = CompletableDeferred<Unit>()
        f.api.leave = { _, _ -> f.api.manifest = { gate.await(); manifestJson(rooms = "") } }
        f.gateway.submitRoomCommand(f.intent(RoomAction.LEAVE)); runCurrent()
        assertEquals(RoomCommandPhase.RECONCILING, f.gateway.roomCommands.value.phase)
        assertNull(f.gateway.roomCommands.value.directory)
        assertEquals(1, (f.db.pages.last() as MembershipPage.Success).rooms.size)
        gate.complete(Unit); runCurrent()
        assertTrue(f.gateway.roomCommands.value.directory!!.memberships.isEmpty()); assertEquals(1, f.api.leaves)
    }
    @Test fun invalidationFailureSendsNoPostAndRetryIsReadOnly() = runTest {
        val f = mutationFixture(); f.db.beforeBegin = { throw RoomsStorageException() }
        f.gateway.submitRoomCommand(f.intent()); runCurrent()
        assertEquals(0, f.api.joins); assertEquals(RoomCommandIssue.STORAGE, f.gateway.roomCommands.value.issue)
        assertEquals(RoomCommandPhase.UNVERIFIED, f.gateway.roomCommands.value.phase)
        f.db.beforeBegin = {}; f.gateway.recheckRoomCommand(f.scope); runCurrent()
        assertEquals(0, f.api.joins); assertEquals(RoomCommandPhase.VERIFIED, f.gateway.roomCommands.value.phase)
    }
    @Test fun stale401CannotClearRotatedSessionAndCurrent401ClearsIt() = runTest {
        for (rotate in listOf(false, true)) {
            val f = mutationFixture(); val gate = CompletableDeferred<Unit>()
            f.api.join = { _, _ -> gate.await(); throw ApiException(401, "UNAUTHENTICATED") }
            f.gateway.submitRoomCommand(f.intent()); runCurrent()
            if (rotate) f.loginAs(OTHER, fingerprint("new-current-credential"))
            gate.complete(Unit); runCurrent()
            assertEquals(if (rotate) ShellAccess.READY else ShellAccess.SIGNED_OUT, f.gateway.session.value.access)
            assertEquals(RoomCommandPhase.NONE, f.gateway.roomCommands.value.phase)
        }
    }
    @Test fun expiryDuringInvalidationOrAfterPostCannotApplyMembership() = runTest {
        for (beforePost in listOf(true, false)) {
            var now = NOW
            val clock = object : Clock() { override fun instant() = now; override fun getZone() = ZoneOffset.UTC; override fun withZone(zone: ZoneId) = this }
            val f = mutationFixture(clock)
            if (beforePost) f.db.beforeBegin = { now = EXPIRY }
            else f.api.join = { _, _ -> now = EXPIRY; joinJson() }
            f.gateway.submitRoomCommand(f.intent()); runCurrent()
            assertEquals(if (beforePost) 0 else 1, f.api.joins)
            assertEquals(ShellAccess.SIGNED_OUT, f.gateway.session.value.access)
            assertNull(f.gateway.roomCommands.value.directory)
        }
    }
    @Test fun failureEmissionCannotStartConcurrentReconciliationOrExposeIntermediateRetry() = runTest {
        val f = mutationFixture(); val gate = CompletableDeferred<Unit>()
        val phases = mutableListOf<RoomCommandPhase>()
        val retries = mutableListOf<Result<Unit>>()
        backgroundScope.launch(UnconfinedTestDispatcher(testScheduler)) {
            f.gateway.roomCommands.collect {
                phases += it.phase
                if (it.phase == RoomCommandPhase.UNVERIFIED || it.phase == RoomCommandPhase.RECONCILING)
                    retries += f.gateway.recheckRoomCommand(f.scope)
            }
        }
        f.api.join = { _, _ -> f.api.manifest = { gate.await(); manifestJson() }; throw IOException() }
        f.gateway.submitRoomCommand(f.intent()); runCurrent()
        assertEquals(RoomCommandPhase.RECONCILING, f.gateway.roomCommands.value.phase)
        assertFalse(phases.contains(RoomCommandPhase.UNVERIFIED))
        assertEquals(2, f.api.manifestCalls) // initial directory + exactly one reconciliation cycle.
        assertTrue(retries.all { it.exceptionOrNull() is RoomCommandInProgress })
        gate.complete(Unit); runCurrent()
        assertEquals(RoomCommandPhase.VERIFIED, f.gateway.roomCommands.value.phase); assertEquals(1, f.api.joins)
    }
    @Test fun unknownNoticeSurvivesNewViewModelAndManualGetWithoutReplayingOldDirectory() = runTest {
        val f = mutationFixture(); f.api.join = { _, _ -> throw IOException() }
        f.gateway.submitRoomCommand(f.intent()); runCurrent()
        val oldCycle = f.gateway.roomCommands.value.directory!!.cycle
        val first = RoomsViewModel(f.gateway, f.scope, backgroundScope); runCurrent()
        assertEquals(RoomCommandIssue.UNKNOWN.message, first.state.value.notice)
        assertNotEquals(oldCycle, first.state.value.directory!!.cycle)
        ViewModelStore().apply { put("rooms", first); clear() }
        val second = RoomsViewModel(f.gateway, f.scope, backgroundScope); runCurrent()
        assertEquals(RoomCommandIssue.UNKNOWN.message, second.state.value.notice)
        val beforeRefresh = second.state.value.directory!!.cycle
        second.reload(); runCurrent()
        assertEquals(RoomCommandIssue.UNKNOWN.message, second.state.value.notice)
        assertNotEquals(beforeRefresh, second.state.value.directory!!.cycle)
        assertEquals(1, f.api.joins)
    }
    @Test fun unknownNoticeSurvivesLoadingFailedAndCancelledReadsAndFreshViewModelWithoutOldRows() = runTest {
        val f = mutationFixture(); f.api.join = { _, _ -> throw IOException() }
        f.gateway.submitRoomCommand(f.intent()); runCurrent()
        val model = RoomsViewModel(f.gateway, f.scope, backgroundScope); runCurrent()
        val gate = CompletableDeferred<Unit>()
        f.api.manifest = { gate.await(); throw IOException() }
        model.reload(); runCurrent()
        assertTrue(model.state.value.loading); assertNull(model.state.value.directory)
        assertEquals(RoomCommandIssue.UNKNOWN.message, model.state.value.notice)
        gate.complete(Unit); runCurrent()
        assertNotNull(model.state.value.error); assertNull(model.state.value.directory)
        assertEquals(RoomCommandIssue.UNKNOWN.message, model.state.value.notice)
        ViewModelStore().apply { put("rooms", model); clear() }
        val recreated = RoomsViewModel(f.gateway, f.scope, backgroundScope); runCurrent()
        assertNull(recreated.state.value.directory); assertNotNull(recreated.state.value.error)
        assertEquals(RoomCommandIssue.UNKNOWN.message, recreated.state.value.notice)
        f.api.manifest = { throw CancellationException("isolated_get_cancel") }
        recreated.reload(); runCurrent()
        assertFalse(recreated.state.value.loading); assertNotNull(recreated.state.value.error)
        assertEquals(RoomCommandIssue.UNKNOWN.message, recreated.state.value.notice)
        f.api.manifest = { manifestJson() }; f.api.discovery = { discoveryJson(next = ROOM_TWO) }
        recreated.reload(); runCurrent()
        val confirmed = recreated.state.value.directory
        f.api.discovery = { throw IOException() }
        recreated.more()
        assertEquals(RoomCommandIssue.UNKNOWN.message, recreated.state.value.notice)
        runCurrent(); assertEquals(confirmed, recreated.state.value.directory); assertNotNull(recreated.state.value.error)
        assertEquals(RoomCommandIssue.UNKNOWN.message, recreated.state.value.notice); assertEquals(1, f.api.joins)
    }
    @Test fun oldRenderedJoinAndLeaveHandlersCannotRebindToNewCycleButFreshHandlersWork() = runTest {
        for (action in RoomAction.entries) {
            val f = mutationFixture()
            val model = RoomsViewModel(f.gateway, f.scope, backgroundScope); runCurrent()
            val shown = model.state.value.directory!!
            val oldHandler: () -> Unit = when (action) {
                RoomAction.JOIN -> { { model.join(RoomId(ROOM_TWO), shown.cycle) } }
                RoomAction.LEAVE -> { { model.submit(model.leaveIntent(shown.memberships.single(), shown.cycle)) } }
            }
            model.reload(); runCurrent()
            assertNotEquals(shown.cycle, model.state.value.directory!!.cycle)
            oldHandler(); runCurrent()
            assertEquals(0, f.api.joins); assertEquals(0, f.api.leaves)
            val fresh = model.state.value.directory!!
            when (action) {
                RoomAction.JOIN -> model.join(RoomId(ROOM_TWO), fresh.cycle)
                RoomAction.LEAVE -> model.submit(model.leaveIntent(fresh.memberships.single(), fresh.cycle))
            }
            runCurrent()
            assertEquals(if (action == RoomAction.JOIN) 1 else 0, f.api.joins)
            assertEquals(if (action == RoomAction.LEAVE) 1 else 0, f.api.leaves)
        }
    }
    @Test fun preMutationDiscoveryResponseCannotOverwriteAfterOneShotCommand() = runTest {
        val f = mutationFixture(); val late = CompletableDeferred<Unit>()
        f.api.discovery = { discoveryJson(next = ROOM_TWO) }
        f.directory = f.gateway.refreshRooms(f.scope).getOrThrow()
        f.api.discovery = { after -> if (after != null) withContext(NonCancellable) { late.await() }; discoveryJson() }
        val old = async { runCatching { f.gateway.moreRooms(f.scope, DiscoveryContinuation(f.directory.cycle, RoomId(ROOM_TWO))) } }
        runCurrent(); f.gateway.submitRoomCommand(f.intent()); runCurrent()
        val state = f.gateway.roomCommands.value; val commits = f.db.commits
        late.complete(Unit); old.await(); runCurrent()
        assertEquals(state, f.gateway.roomCommands.value); assertEquals(commits, f.db.commits)
    }
}
