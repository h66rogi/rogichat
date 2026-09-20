package chat.rogi.rogichat.core.conversation

import chat.rogi.rogichat.core.network.*
import chat.rogi.rogichat.core.rooms.RoomsStorageException
import java.time.Clock
import java.util.UUID
import java.util.concurrent.ConcurrentHashMap
import kotlinx.coroutines.*
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock

data class ConversationState(val loading: Boolean = true, val data: ConversationData? = null, val error: String? = null,
                             val sending: Boolean = false, val recipients: List<PrivateRecipient> = emptyList(),
                             val recipientRevision: RoomId? = null, val recipientNext: RoomId? = null)
class ConversationHandle internal constructor(val selection: ConversationSelection, internal val identity: String,
                                              val state: StateFlow<ConversationState>)
data class TextSendIntent(val scope: ConversationScope, val command: TextCommand, val recipientRevision: RoomId?)
interface ConversationRepository {
    fun open(selection: ConversationSelection): ConversationHandle
    suspend fun refresh(handle: ConversationHandle)
    suspend fun poll(handle: ConversationHandle)
    suspend fun history(handle: ConversationHandle)
    suspend fun moreRecipients(handle: ConversationHandle)
    suspend fun reconcile(handle: ConversationHandle)
    suspend fun send(handle: ConversationHandle, intent: TextSendIntent): Result<Unit>
}

/** New chat orchestration, not Meloming Talk UX. Meloming repository/StateFlow/error conventions
 * are retained; session gateway owns credential admission and SQLite lifecycle serialization. */
class RoomConversationCoordinator(private val gateway: ConversationGateway, private val storage: ConversationStore,
                                  private val owner: CoroutineScope, private val clock: Clock = Clock.systemUTC()) : ConversationRepository {
    private class Entry(val selection: ConversationSelection) {
        val identity = UUID.randomUUID().toString(); val state = MutableStateFlow(ConversationState()); val mutex = Mutex()
        var permit: ConversationPermit? = null; var scope: ConversationScope? = null; var activeCommand: RoomId? = null
        var retired = false; var started = false
    }
    private val publication = ConversationPublicationFence()
    private val entries = ConcurrentHashMap<ConversationSelection, Entry>()
    override fun open(selection: ConversationSelection): ConversationHandle {
        val entry = publication.serial { entries.computeIfAbsent(selection) { Entry(it) } }
        val handle = ConversationHandle(selection, entry.identity, entry.state.asStateFlow())
        synchronized(entry) { if (!entry.started) { entry.started = true; owner.launch { refresh(handle) } } }
        return handle
    }
    /** Synchronous before any lifecycle await: no previous account frame survives a private-scope close. */
    fun invalidateAll() = publication.serial {
        entries.values.forEach { it.retired = true; it.state.value = ConversationState(loading = false) }
        entries.clear()
    }
    private fun update(entry: Entry, change: (ConversationState) -> ConversationState) = publication.publish(
        isCurrent = { !entry.retired && entries[entry.selection] === entry },
        write = { entry.state.value = change(entry.state.value) },
    )
    private fun entry(handle: ConversationHandle) = entries[handle.selection]?.takeIf { it.identity == handle.identity && !it.retired }
        ?: throw CancellationException("conversation_closed")
    private fun ensure(entry: Entry) { if (entry.retired || entries[entry.selection] !== entry) throw CancellationException("conversation_closed") }
    private fun query(entry: Entry, cursor: SyncCursor? = null) = ManifestRequest(requireNotNull(entry.permit).deviceId, requireNotNull(entry.scope).cacheId, cursor)
    private suspend fun <T> request(entry: Entry, action: suspend (NativeApi, String) -> T): T {
        ensure(entry); return gateway.conversationRequest(requireNotNull(entry.permit), action).also { ensure(entry) }
    }
    private suspend fun <T> commit(entry: Entry, action: suspend (() -> Unit) -> T): T {
        ensure(entry); return gateway.conversationCommit(requireNotNull(entry.permit)) { validate -> action { ensure(entry); validate() } }.also { ensure(entry) }
    }
    private fun publish(entry: Entry, data: ConversationData) {
        ensure(entry); require(entry.scope == data.scope); update(entry) { it.copy(data = data, loading = false, error = null) }
    }
    private fun message(failure: Exception) = when (failure) {
        is RoomsStorageException -> "기기에 대화를 저장하지 못했어요. 저장 공간을 확인하고 다시 시도해 주세요."
        is ApiException -> when (failure.statusCode) {
            403, 404, 409 -> "대화의 참여 상태나 권한이 바뀌었어요. 대화 목록에서 다시 확인해 주세요."
            else -> "대화를 확인하지 못했어요. 연결 상태를 확인하고 다시 시도해 주세요."
        }
        else -> "대화를 확인하지 못했어요. 연결 상태를 확인하고 다시 시도해 주세요."
    }
    private suspend fun guarded(handle: ConversationHandle, action: suspend (Entry) -> Unit) {
        val entry = entry(handle)
        entry.mutex.withLock {
            ensure(entry)
            try { action(entry) }
            catch (cancelled: CancellationException) { throw cancelled }
            catch (failure: Exception) {
                if (failure is ConversationReset || failure is InvalidResponse || failure is ApiException && failure.statusCode in setOf(403, 404, 409)) reset(entry)
                else update(entry) { it.copy(loading = false, error = message(failure)) }
            }
        }
    }
    override suspend fun refresh(handle: ConversationHandle) = guarded(handle) { entry ->
        if (entry.activeCommand != null) return@guarded
        update(entry) { ConversationState() }
        entry.permit = gateway.admitConversation(entry.selection)
        replaceSnapshot(entry)
        recover(entry)
    }
    private suspend fun replaceSnapshot(entry: Entry) {
        update(entry) { ConversationState(sending = entry.activeCommand != null) }
        entry.scope = commit(entry) { storage.beginConversation(entry.selection, it) }
        val snapshot = request(entry) { api, token -> ConversationDtos.snapshot(api.getConversation(token, entry.selection.membership.roomId, ConversationRoute.SNAPSHOT, query(entry))) }
        publish(entry, commit(entry) { storage.snapshot(requireNotNull(entry.scope), snapshot, it) })
        loadProfiles(entry)
        if (entry.selection.membership.mode == RoomMode.FAN) recipients(entry, null)
    }
    private suspend fun loadProfiles(entry: Entry) {
        var cursor: SyncCursor? = null
        repeat(101) {
            val page = request(entry) { api, token -> ConversationDtos.profiles(api.getConversation(token, entry.selection.membership.roomId, ConversationRoute.PROFILES, query(entry, cursor))) }
            if (page is ProfilePage.Reset) throw ConversationReset()
            page as ProfilePage.Success
            publish(entry, commit(entry) { storage.profiles(requireNotNull(entry.scope), cursor, page, it) })
            if (page.complete) return
            cursor = page.next
        }
        throw InvalidResponse()
    }
    override suspend fun poll(handle: ConversationHandle) = guarded(handle) { entry ->
        if (entry.state.value.loading || entry.scope == null) return@guarded
        repeat(101) {
            val cursor = entry.state.value.data?.eventsCursor ?: return@guarded
            val page = request(entry) { api, token -> ConversationDtos.events(api.getConversation(token, entry.selection.membership.roomId, ConversationRoute.EVENTS, query(entry, cursor))) }
            if (page is EventPage.Reset) { reset(entry); return@guarded }
            page as EventPage.Success
            publish(entry, commit(entry) { storage.events(requireNotNull(entry.scope), cursor, page, it) })
            if (!page.hasMore) return@guarded
        }
        throw InvalidResponse()
    }
    private fun reset(entry: Entry) {
        entry.scope = null
        update(entry) { ConversationState(loading = false, error = "대화의 권한 정보가 바뀌었어요. 대화 목록에서 다시 확인해 주세요.") }
    }
    override suspend fun history(handle: ConversationHandle) = guarded(handle) { entry ->
        val cursor = entry.state.value.data?.historyCursor ?: return@guarded
        val page = request(entry) { api, token -> ConversationDtos.history(api.getConversation(token, entry.selection.membership.roomId, ConversationRoute.HISTORY, query(entry, cursor))) }
        if (page is HistoryPage.Reset) { reset(entry); return@guarded }
        page as HistoryPage.Success
        publish(entry, commit(entry) { storage.history(requireNotNull(entry.scope), cursor, page, it) })
    }
    private suspend fun recipients(entry: Entry, after: RoomId?) {
        val page = request(entry) { api, token -> ConversationDtos.recipients(api.getPrivateRecipients(token, entry.selection.membership.roomId, after)) }
        val previous = if (after == null) emptyList() else entry.state.value.recipients
        if (page.recipients.any { next -> previous.any { it.actorId == next.actorId } } || previous.size + page.recipients.size > 10000) throw InvalidResponse()
        update(entry) { it.copy(recipients = previous + page.recipients, recipientNext = page.next,
            recipientRevision = if (after == null) RoomId(UUID.randomUUID().toString()) else it.recipientRevision) }
    }
    override suspend fun moreRecipients(handle: ConversationHandle) = guarded(handle) { entry -> entry.state.value.recipientNext?.let { recipients(entry, it) } }
    override suspend fun reconcile(handle: ConversationHandle) = guarded(handle) { entry -> recover(entry) }
    private suspend fun recover(entry: Entry) {
        val scope = entry.scope ?: return
        val records = commit(entry) { storage.current(scope, it) }.outbox
        for (record in records.filter { it.phase in setOf(OutboxPhase.PREPARED, OutboxPhase.SENDING, OutboxPhase.UNKNOWN, OutboxPhase.COMMITTED) && it.command.membership == scope.selection.membership.membershipScope }) {
            if (entry.activeCommand == record.command.clientMessageId) continue
            val receipt = try {
                request(entry) { api, token -> ConversationDtos.receipt(api.getMessageReceipt(token, scope.selection.membership.roomId, record.command.clientMessageId), fromLookup = true) }
            } catch (failure: ApiException) {
                if (failure.statusCode != 404) throw failure
                // Only this receipt endpoint's absence is ambiguous; nested room failures are not.
                continue
            }
            acceptReceipt(entry, record.command.clientMessageId, receipt)
        }
    }
    private suspend fun acceptReceipt(entry: Entry, command: RoomId, receipt: CommandReceipt) {
        val scope = requireNotNull(entry.scope)
        val original = commit(entry) { storage.current(scope, it) }.outbox.find { it.command.clientMessageId == command } ?: return
        val knownDeletedId = original.messageId ?: (receipt as? CommandReceipt.Deleted)?.messageId
        publish(entry, commit(entry) { storage.receipt(scope, command, receipt, it) })
        if (receipt is CommandReceipt.Deleted && knownDeletedId == null) {
            // Deleted lookup with no mapping cannot identify an old visible row by text/time.
            // Withdraw that cache and obtain a fresh authoritative snapshot instead.
            replaceSnapshot(entry)
        } else if (receipt is CommandReceipt.Committed) {
            val message = try {
                request(entry) { api, token -> ConversationDtos.message(api.getMessage(token, scope.selection.membership.roomId, receipt.messageId)) }
            } catch (failure: ApiException) {
                if (failure.statusCode !in setOf(403, 404)) throw failure
                // This endpoint can deny one message without withdrawing room authority.
                publish(entry, commit(entry) { storage.unavailableProjection(scope, command, receipt.messageId, it) })
                update(entry) { it.copy(error = "메시지 저장은 확인했지만 지금 내용을 볼 수 없어요.") }
                return
            }
            if (message.id != receipt.messageId) throw InvalidResponse()
            publish(entry, commit(entry) { storage.projection(scope, message, it) })
        }
    }
    override suspend fun send(handle: ConversationHandle, intent: TextSendIntent): Result<Unit> = try {
        val entry = entry(handle)
        entry.mutex.withLock {
            ensure(entry); if (entry.activeCommand != null || entry.scope != intent.scope) throw CancellationException("stale_send_intent")
            val current = requireNotNull(entry.state.value.data); val membership = entry.selection.membership
            require(intent.command.membership == membership.membershipScope)
            if (intent.command.quote != null) {
                val quote = current.messages.singleOrNull { it.id == intent.command.quote } ?: throw InvalidResponse()
                require(intent.command.intent == "PRIVATE" && quote.actions.reply && quote.replyTarget != null && quote.replyTarget == intent.command.recipient)
            } else if (intent.command.intent == "SHARED") require(membership.mode == RoomMode.GROUP || membership.role == RoomRole.STREAMER)
            else {
                require(membership.mode == RoomMode.FAN && intent.recipientRevision != null && intent.recipientRevision == entry.state.value.recipientRevision)
                require(entry.state.value.recipients.any { it.actorId == intent.command.recipient })
            }
            // A real user intent is durable before the session-owned asynchronous dispatch starts.
            // Once the durable intent commits, cancellation cannot leave an unowned active command.
            withContext(NonCancellable) {
                commit(entry) { storage.enqueue(intent.scope, intent.command, clock.millis(), it) }
                entry.activeCommand = intent.command.clientMessageId
                update(entry) { it.copy(sending = true, error = null) }
                owner.launch { dispatch(entry, intent) }
            }
        }
        Result.success(Unit)
    } catch (cancelled: CancellationException) { throw cancelled }
    catch (failure: Exception) { Result.failure(failure) }
    private suspend fun dispatch(entry: Entry, intent: TextSendIntent) {
        entry.mutex.withLock {
            try {
                ensure(entry)
                publish(entry, commit(entry) { storage.current(intent.scope, it) })
                commit(entry) { storage.markSending(intent.scope, intent.command.clientMessageId, it) }
                val receipt = request(entry) { api, token -> ConversationDtos.receipt(api.sendText(token, entry.selection.membership.roomId, intent.command), fromLookup = false) }
                acceptReceipt(entry, intent.command.clientMessageId, receipt)
            } catch (failure: Exception) {
                if (!entry.retired) {
                    try { withContext(NonCancellable) {
                        commit(entry) { storage.markUnknown(intent.scope, intent.command.clientMessageId, (failure as? ApiException)?.code, it) }
                        publish(entry, commit(entry) { storage.current(intent.scope, it) })
                    } } catch (_: Exception) { /* A retired authority remains recoverable only after a fresh manifest. */ }
                    if (failure is ApiException && failure.statusCode in setOf(403, 404, 409)) reset(entry)
                    else update(entry) { it.copy(error = "전송 결과를 확인하지 못했어요. 결과 확인은 메시지를 다시 보내지 않아요.") }
                }
            } finally {
                entry.activeCommand = null
                update(entry) { it.copy(sending = false) }
            }
        }
    }
    private class ConversationReset : Exception("conversation_reset_required")
}

/** The predicate and final StateFlow write share invalidation's short synchronous lock.
 * Never perform database/network work in this fence or acquire the session mutex from it. */
internal class ConversationPublicationFence {
    private val monitor = Any()
    fun <T> serial(action: () -> T): T = synchronized(monitor, action)
    fun publish(isCurrent: () -> Boolean, write: () -> Unit) = serial {
        if (isCurrent()) write()
    }
}
