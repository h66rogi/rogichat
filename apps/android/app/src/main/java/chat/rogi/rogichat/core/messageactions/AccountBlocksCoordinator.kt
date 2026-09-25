package chat.rogi.rogichat.core.messageactions

import chat.rogi.rogichat.core.conversation.ActionJournalSlot
import chat.rogi.rogichat.core.network.ApiException
import chat.rogi.rogichat.core.session.*
import java.util.UUID
import kotlinx.coroutines.*
import kotlinx.coroutines.flow.*
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock

data class AccountBlocksView(val roomCycle: UUID = UUID.randomUUID(), val rooms: List<BlockedRoom> = emptyList(), val room: BlockedRoom? = null,
    val token: BlockViewToken? = null, val blocks: List<BlockedActor> = emptyList(), val complete: Boolean = false,
    val busy: Boolean = true, val error: String? = null, val unknownActors: Set<String> = emptySet(), val outcome: UnblockOutcome? = null)
class AccountBlocksHandle internal constructor(internal val expected: SessionIdentity, internal val key: UUID,
    val state: StateFlow<AccountBlocksView>)
/** Reuses the reviewed ActorBlocksState with the existing account Room transaction, never a second bearer client. */
class AccountBlocksCoordinator(private val gateway: AccountFeatureGateway, private val store: AccountFeatureStore,
    private val owner: CoroutineScope, private val environment: String) {
    private class Entry(val expected: SessionIdentity) {
        val key = UUID.randomUUID(); val mutex = Mutex(); val state = MutableStateFlow(AccountBlocksView())
        val journal = BlockJournalSlot(); val actions = ActionJournalSlot(); val model = ActorBlocksState(journal, actions)
        var permit: AccountFeaturePermit? = null; var retired = false
    }
    private val publication = Any()
    private val entries = mutableMapOf<SessionIdentity, Entry>()
    fun invalidate() = synchronized(publication) {
        entries.values.forEach { it.retired = true; it.model.select(null); it.state.value = AccountBlocksView(busy = false) }; entries.clear()
    }
    private fun current(entry: Entry) { if (entry.retired || synchronized(publication) { entries[entry.expected] !== entry }) throw CancellationException("block_view_closed") }
    private fun publish(entry: Entry, value: AccountBlocksView) = synchronized(publication) { if (!entry.retired && entries[entry.expected] === entry) entry.state.value = value }
    fun open(expected: SessionIdentity): AccountBlocksHandle {
        val entry = synchronized(publication) { entries.getOrPut(expected) { Entry(expected) } }
        val handle = AccountBlocksHandle(expected, entry.key, entry.state.asStateFlow()); rooms(handle); return handle
    }
    private fun entry(handle: AccountBlocksHandle) = synchronized(publication) { entries[handle.expected]?.takeIf { it.key == handle.key && !it.retired } } ?: throw CancellationException("block_view_closed")
    private suspend fun <T> transaction(entry: Entry, operation: () -> T): T {
        val permit = requireNotNull(entry.permit)
        return gateway.accountFeatureCommit(permit) { validate -> store.blockTransaction(permit.account, { current(entry); validate() }) { blocks, actions ->
            entry.journal.transaction(blocks) { entry.actions.transaction(actions, operation) }
        } }
    }
    private suspend fun show(entry: Entry, busy: Boolean = false, error: String? = null) {
        val value = transaction(entry) { entry.state.value.copy(token = entry.model.capture(), blocks = entry.model.blocks,
            complete = entry.model.complete, busy = busy, error = error, unknownActors = entry.model.unknownActors(), outcome = entry.model.lastOutcome) }
        publish(entry, value)
    }
    fun rooms(handle: AccountBlocksHandle) { val entry = entry(handle); owner.launch { entry.mutex.withLock {
        current(entry); if (entry.model.pending != null) return@withLock
        entry.model.select(null); publish(entry, AccountBlocksView())
        try {
            val permit = gateway.admitAccountFeature(entry.expected); entry.permit = permit
            val result = mutableListOf<BlockedRoom>(); val cursors = mutableSetOf<String>(); var cursor: String? = null
            do {
                val reply = gateway.accountFeatureRequest(permit) { api, bearer, gate -> api.messageActionAdmitted(bearer, BlockedRoomsWire.request(cursor), gate) }
                if (reply.status != 200) throw ApiException(reply.status, null)
                val page = BlockedRoomsWire.page(reply.body)
                check(page.rooms.none { item -> result.any { it.id == item.id } }); result += page.rooms
                check(result.size <= 10000 && cursors.size < 200)
                cursor = page.next; if (cursor != null) check(cursors.add(cursor))
            } while (cursor != null) // An empty prefix does not mean completion.
            permit.check(); publish(entry, AccountBlocksView(rooms = result, complete = true, busy = false))
        } catch (cancelled: CancellationException) { throw cancelled }
        catch (_: Exception) { publish(entry, AccountBlocksView(busy = false, error = "차단한 사용자가 있는 대화를 확인하지 못했어요. 다시 확인해 주세요.")) }
    } } }
    fun select(handle: AccountBlocksHandle, cycle: UUID, displayed: BlockedRoom) { val entry = entry(handle); owner.launch { entry.mutex.withLock {
        current(entry); if (entry.state.value.roomCycle != cycle || entry.state.value.busy || entry.state.value.rooms.none { it == displayed } || entry.model.pending != null) return@withLock
        val permit = requireNotNull(entry.permit); permit.check()
        entry.model.select(BlockScope(environment, permit.account.accountId, permit.identity, displayed.id, UUID.randomUUID().toString()))
        publish(entry, entry.state.value.copy(room = displayed, blocks = emptyList(), complete = false, busy = true, error = null))
        load(entry)
    } } }
    fun refresh(handle: AccountBlocksHandle) { val entry = entry(handle); owner.launch { entry.mutex.withLock {
        current(entry); if (entry.model.pending == null) load(entry)
    } } }
    private suspend fun load(entry: Entry) {
        try {
            var page = transaction(entry) { entry.model.refresh() } ?: return
            show(entry, busy = true)
            var count = 0
            while (true) {
                val response = gateway.accountFeatureRequest(requireNotNull(entry.permit)) { api, bearer, gate -> api.messageActionAdmitted(bearer, ActorBlocksWire.list(page), gate) }
                if (response.status != 200) throw ApiException(response.status, null)
                val decoded = ActorBlocksWire.page(response.body)
                val reset = transaction(entry) { entry.model.accept(page, decoded) }
                if (reset != null) gateway.accountBlocksChanged(requireNotNull(entry.permit))
                if (entry.model.complete) break
                check(++count < 200)
                page = transaction(entry) { entry.model.more() } ?: error("incomplete_blocks")
            }
            show(entry)
        } catch (cancelled: CancellationException) { throw cancelled }
        catch (_: Exception) {
            // Withdraw all previous display names on failed refresh; the journal retains unknown history.
            publish(entry, entry.state.value.copy(token = null, blocks = emptyList(), busy = false, complete = false,
                error = "현재 차단 목록을 확인하지 못했어요. 다시 확인해 주세요."))
        }
    }
    fun unblock(handle: AccountBlocksHandle, token: BlockViewToken, actor: String) { val entry = entry(handle); owner.launch { entry.mutex.withLock {
        current(entry); val permit = requireNotNull(entry.permit); permit.check()
        if (entry.model.capture() != token) return@withLock
        try {
            withContext(NonCancellable) {
                var captured: UnblockPermit? = null
                var persisted = false
                var enqueued = false
                try {
                    val command = transaction(entry) { entry.model.unblock(token, actor).also { captured = it } }
                    enqueued = true
                    show(entry, busy = true)
                    // Already on the session-owned scope; leaving the screen never cancels this one command.
                    var result = UnblockOutcome.UNKNOWN
                    try {
                        val response = gateway.accountFeatureRequest(permit) { api, bearer, gate ->
                            api.messageActionAdmitted(bearer, command.request()) { gate(); command.claim() }
                        }
                        result = ActorBlocksWire.result(command, response.status, response.body)
                    } catch (_: Exception) { /* Unknown remains durable; never repeat DELETE. */ }
                    val reset = transaction(entry) { entry.model.finish(command, result) }
                    persisted = true
                    if (reset != null) gateway.accountBlocksChanged(permit)
                    show(entry)
                } finally {
                    if (!persisted) captured?.let { entry.model.dispatchEndedWithoutPersistence(it, enqueued) }
                }
            }
            load(entry) // Fresh current state is not proof the preceding unknown command succeeded.
        } catch (cancelled: CancellationException) { throw cancelled }
        catch (_: Exception) { publish(entry, entry.state.value.copy(busy = false, error = "차단 해제 상태를 확인하지 못했어요. 다시 시도해 주세요.")) }
    } } }
}
