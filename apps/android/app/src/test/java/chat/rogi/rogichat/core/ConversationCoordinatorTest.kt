package chat.rogi.rogichat.core

import chat.rogi.rogichat.core.conversation.*
import chat.rogi.rogichat.core.network.*
import chat.rogi.rogichat.core.rooms.*
import kotlinx.coroutines.*
import kotlinx.coroutines.test.*
import org.junit.Assert.*
import org.junit.Test
import java.time.Clock
import java.time.Instant
import java.time.ZoneOffset

private val selection = ConversationSelection(RoomsAccountScope(OWN, 1, AccountPartition("C".repeat(42) + "A")),
    Membership(CONVERSATION_ID, "대화", RoomMode.GROUP, CONVERSATION_ID, RoomRole.MEMBER, SCOPE_M, SCOPE_A), ACTOR_ID)
internal class ConversationMemory : ConversationStore {
    lateinit var scope: ConversationScope
    var rows = mutableListOf<OutboxRecord>(); var snapshot: SnapshotPage? = null
    var beforeCurrent: suspend () -> Unit = {}; var commits = 0
    override suspend fun authorize(scope: RoomsAccountScope, credentialBinding: String, serverGeneration: String, validate: () -> Unit) = validate()
    override suspend fun withdrawAuthority() = Unit
    override suspend fun beginConversation(selection: ConversationSelection, validate: () -> Unit): ConversationScope {
        validate(); scope = ConversationScope(selection, RoomId(java.util.UUID.randomUUID().toString())); return scope
    }
    private fun data() = ConversationData(scope, snapshot?.messages.orEmpty(), emptyList(), true, snapshot?.next, snapshot?.history, rows.toList())
    override suspend fun snapshot(scope: ConversationScope, page: SnapshotPage, validate: () -> Unit): ConversationData { validate(); snapshot = page; return data() }
    override suspend fun events(scope: ConversationScope, requested: SyncCursor, page: EventPage.Success, validate: () -> Unit): ConversationData { validate(); return data() }
    override suspend fun history(scope: ConversationScope, requested: SyncCursor, page: HistoryPage.Success, validate: () -> Unit): ConversationData { validate(); return data() }
    override suspend fun profiles(scope: ConversationScope, requested: SyncCursor?, page: ProfilePage.Success, validate: () -> Unit): ConversationData { validate(); return data() }
    override suspend fun current(scope: ConversationScope, validate: () -> Unit): ConversationData { beforeCurrent(); validate(); return data() }
    override suspend fun enqueue(scope: ConversationScope, command: TextCommand, createdAtMs: Long, validate: () -> Unit): OutboxRecord {
        validate(); assertFalse(rows.any { it.command.clientMessageId == command.clientMessageId }); commits++
        return OutboxRecord(command, SCOPE_A, OutboxPhase.PREPARED, createdAtMs).also { rows += it }
    }
    override suspend fun markSending(scope: ConversationScope, commandId: RoomId, validate: () -> Unit) { validate(); rows.replaceAll { if (it.command.clientMessageId == commandId) it.copy(phase = OutboxPhase.SENDING) else it } }
    override suspend fun markUnknown(scope: ConversationScope, commandId: RoomId, errorCode: String?, validate: () -> Unit) { validate(); rows.replaceAll { if (it.command.clientMessageId == commandId) it.copy(phase = OutboxPhase.UNKNOWN) else it } }
    override suspend fun receipt(scope: ConversationScope, commandId: RoomId, receipt: CommandReceipt, validate: () -> Unit): ConversationData {
        validate(); require(commandId == receipt.clientMessageId)
        rows.replaceAll { if (it.command.clientMessageId != commandId) it else when(receipt) {
            is CommandReceipt.Committed -> it.copy(phase = OutboxPhase.COMMITTED, messageId = receipt.messageId, version = receipt.version)
            is CommandReceipt.Deleted -> it.copy(phase = OutboxPhase.DELETED)
        } }; return data()
    }
    override suspend fun unavailableProjection(scope: ConversationScope, commandId: RoomId, messageId: RoomId, validate: () -> Unit): ConversationData {
        validate(); snapshot = snapshot!!.copy(messages = snapshot!!.messages.filterNot { it.id == messageId })
        rows.replaceAll { if (it.command.clientMessageId == commandId && it.phase == OutboxPhase.COMMITTED) it.copy(errorCode = "PROJECTION_UNAVAILABLE") else it }
        return data()
    }
    override suspend fun projection(scope: ConversationScope, message: ConversationMessage, validate: () -> Unit): ConversationData { validate(); snapshot = snapshot!!.copy(messages = listOf(message)); return data() }
}
private class ConversationTransport : NativeApi {
    var sends = 0; var lookups = 0
    var eventFailure: Exception? = null; var messageFailure: Exception? = null
    var sending: suspend (TextCommand) -> String = { """{"clientMessageId":"${it.clientMessageId.value}","status":"committed","messageId":"${MESSAGE_ID.value}","version":"7"}""" }
    var lookup: suspend (RoomId) -> String = { throw ApiException(404, "NOT_FOUND") }
    override suspend fun sendText(token: String, room: RoomId, command: TextCommand): String { sends++; return sending(command) }
    override suspend fun getMessageReceipt(token: String, room: RoomId, command: RoomId): String { lookups++; return lookup(command) }
    override suspend fun getMessage(token: String, room: RoomId, message: RoomId): String { messageFailure?.let { throw it }; return messageProjection() }
    override suspend fun getConversation(token: String, room: RoomId, route: ConversationRoute, query: ManifestRequest): String = when(route) {
        ConversationRoute.SNAPSHOT -> snapshotProjection()
        ConversationRoute.PROFILES -> """{"schemaVersion":2,"resetRequired":false,"membershipScope":"${SCOPE_M.value}","authorizationRevision":"${SCOPE_A.value}","profiles":[],"generation":"profiles","complete":true,"nextCursor":null}"""
        ConversationRoute.EVENTS -> {
            eventFailure?.let { throw it }
            """{"schemaVersion":2,"resetRequired":false,"membershipScope":"${SCOPE_M.value}","authorizationRevision":"${SCOPE_A.value}","events":[],"hasMore":false,"nextCursor":"events-two"}"""
        }
        else -> error("unexpected")
    }
    override suspend fun get(route: ApiRoute, token: String): String = error("unexpected")
    override suspend fun patch(route: ApiRoute, token: String, body: String): String = error("unexpected")
    override suspend fun postWithoutResponse(route: ApiRoute, token: String, body: String) = error("unexpected")
}
private class ConversationAccess(private val api: NativeApi) : ConversationGateway {
    var valid = true
    override suspend fun admitConversation(selection: ConversationSelection): ConversationPermit { check(valid); return ConversationPermit(selection, ACTOR_ID, Any()) }
    private fun validate() { if (!valid) throw CancellationException("changed") }
    override suspend fun <T> conversationRequest(permit: ConversationPermit, request: suspend (NativeApi, String) -> T): T {
        validate(); val result = request(api, TOKEN); validate(); return result
    }
    override suspend fun <T> conversationCommit(permit: ConversationPermit, action: suspend (() -> Unit) -> T): T { validate(); return action(::validate).also { validate() } }
}
@OptIn(ExperimentalCoroutinesApi::class)
class ConversationCoordinatorTest {
    @Test fun enqueueCommitPrecedesSingleOwnedPostEvenWhenUiCallerIsCancelledDuringReadback() = runTest {
        val api = ConversationTransport(); val store = ConversationMemory(); val access = ConversationAccess(api)
        val model = RoomConversationCoordinator(access, store, backgroundScope)
        val handle = model.open(selection); runCurrent(); val scope = requireNotNull(handle.state.value.data).scope
        val gate = CompletableDeferred<Unit>(); val entered = CompletableDeferred<Unit>()
        store.beforeCurrent = { entered.complete(Unit); gate.await() }
        api.sending = { command -> assertEquals(1, store.commits); assertEquals(OutboxPhase.SENDING, store.rows.single().phase)
            """{"clientMessageId":"${command.clientMessageId.value}","status":"committed","messageId":"${MESSAGE_ID.value}","version":"7"}""" }
        val uiJob = launch { model.send(handle, TextSendIntent(scope, TextCommand(ACTOR_ID, SCOPE_M, "SHARED", null, null, "작성한 메시지"), null)).getOrThrow() }
        runCurrent(); entered.await(); uiJob.cancel(); gate.complete(Unit); runCurrent()
        assertEquals(1, api.sends); assertEquals(OutboxPhase.COMMITTED, store.rows.single().phase); assertFalse(handle.state.value.sending)
    }
    @Test fun roomPoll404ClosesDataAndPreventsSendButReceipt404RetainsUnknownWithoutPost() = runTest {
        val api = ConversationTransport(); val store = ConversationMemory(); val model = RoomConversationCoordinator(ConversationAccess(api), store, backgroundScope)
        val handle = model.open(selection); runCurrent(); val original = requireNotNull(handle.state.value.data).scope
        store.rows += OutboxRecord(TextCommand(ACTOR_ID, SCOPE_M, "SHARED", null, null, "확인할 메시지"), SCOPE_A, OutboxPhase.UNKNOWN, 1)
        model.reconcile(handle); assertEquals(1, api.lookups); assertNotNull(handle.state.value.data); assertEquals(0, api.sends)
        api.eventFailure = ApiException(404, "NOT_FOUND"); model.poll(handle)
        assertNull(handle.state.value.data); assertTrue(handle.state.value.recipients.isEmpty())
        assertTrue(runCatching { model.send(handle, TextSendIntent(original, TextCommand(MESSAGE_ID, SCOPE_M, "SHARED", null, null, "이전 화면"), null)) }.exceptionOrNull() is CancellationException)
        assertEquals(0, api.sends)
    }
    @Test fun invalidationDuringDelayedNetworkNeverRepublishesPrivateDataToOldHandle() = runTest {
        val api = ConversationTransport(); val store = ConversationMemory(); val access = ConversationAccess(api)
        val model = RoomConversationCoordinator(access, store, backgroundScope)
        val handle = model.open(selection); runCurrent()
        val gate = CompletableDeferred<Unit>(); val entered = CompletableDeferred<Unit>()
        store.beforeCurrent = { entered.complete(Unit); gate.await() }
        val refresh = launch { model.reconcile(handle) }; runCurrent(); entered.await()
        access.valid = false; model.invalidateAll(); assertNull(handle.state.value.data)
        gate.complete(Unit); runCurrent(); refresh.join(); assertNull(handle.state.value.data)
    }
    @Test fun groupReplyRequiresExplicitTrueNonNullTargetAndPrivateIntent() = runTest {
        val api = ConversationTransport(); val store = ConversationMemory(); val model = RoomConversationCoordinator(ConversationAccess(api), store, backgroundScope)
        val handle = model.open(selection); runCurrent(); val scope = requireNotNull(handle.state.value.data).scope
        val forbiddenSharedQuote = TextCommand(ACTOR_ID, SCOPE_M, "SHARED", null, MESSAGE_ID, "인용")
        assertTrue(model.send(handle, TextSendIntent(scope, forbiddenSharedQuote, null)).isFailure); assertEquals(0, store.commits)
        val allowedReply = TextCommand(ACTOR_ID, SCOPE_M, "PRIVATE", ACTOR_ID, MESSAGE_ID, "답장")
        model.send(handle, TextSendIntent(scope, allowedReply, null)).getOrThrow(); runCurrent(); assertEquals(1, api.sends)
    }
    @Test fun individualMessageDenialHidesOnlyProjectionAndKeepsConfirmedReceiptWithoutOriginalBodyFallback() = runTest {
        for (status in listOf(403, 404)) {
            val api = ConversationTransport(); val store = ConversationMemory()
            val model = RoomConversationCoordinator(ConversationAccess(api), store, backgroundScope)
            val handle = model.open(selection); runCurrent(); val scope = requireNotNull(handle.state.value.data).scope
            api.messageFailure = ApiException(status, "NOT_FOUND")
            model.send(handle, TextSendIntent(scope, TextCommand(ACTOR_ID, SCOPE_M, "SHARED", null, null, "원본 본문"), null)).getOrThrow()
            runCurrent()
            val result = requireNotNull(handle.state.value.data)
            assertEquals(scope, result.scope); assertTrue(result.messages.isEmpty())
            assertEquals(OutboxPhase.COMMITTED, result.outbox.single().phase)
            assertEquals("PROJECTION_UNAVAILABLE", result.outbox.single().errorCode); assertEquals(1, api.sends)
            api.lookup = { """{"clientMessageId":"${it.value}","status":"committed","messageId":"${MESSAGE_ID.value}","version":"7"}""" }
            model.reconcile(handle); assertNotNull(handle.state.value.data); assertEquals(1, api.sends)
        }
    }

}
