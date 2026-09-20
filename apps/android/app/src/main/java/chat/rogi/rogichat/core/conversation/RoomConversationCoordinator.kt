package chat.rogi.rogichat.core.conversation

import chat.rogi.rogichat.core.network.*
import chat.rogi.rogichat.core.media.*
import chat.rogi.rogichat.core.messageactions.*
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

data class ConversationActionState(val token: ActionViewToken, val record: ActionRecord?, val unavailable: Set<MessageAction>,
                                   val busy: Boolean = false, val reactions: MessageReactions? = null, val error: String? = null)
data class ConversationState(val loading: Boolean = true, val data: ConversationData? = null, val error: String? = null,
                             val sending: Boolean = false, val recipients: List<PrivateRecipient> = emptyList(),
                             val recipientRevision: RoomId? = null, val recipientNext: RoomId? = null, val action: ConversationActionState? = null, val anchor: ScrollAnchor? = null)
class ConversationHandle internal constructor(val selection: ConversationSelection, internal val identity: String,
                                              val state: StateFlow<ConversationState>)
data class TextSendIntent(val scope: ConversationScope, val command: TextCommand, val recipientRevision: RoomId?)
interface ConversationRepository {
    fun wake() = Unit
    fun open(selection: ConversationSelection): ConversationHandle
    suspend fun refresh(handle: ConversationHandle)
    suspend fun poll(handle: ConversationHandle)
    suspend fun history(handle: ConversationHandle)
    suspend fun moreRecipients(handle: ConversationHandle)
    suspend fun reconcile(handle: ConversationHandle)
    suspend fun displayed(handle: ConversationHandle, scope: ConversationScope, anchor: ScrollAnchor): Unit = Unit
    suspend fun selectAction(handle: ConversationHandle, scope: ConversationScope, message: ConversationMessage): Unit = Unit
    suspend fun closeAction(handle: ConversationHandle): Unit = Unit
    suspend fun runAction(handle: ConversationHandle, token: ActionViewToken, action: MessageAction, emoji: String?, reason: ReportReason?): Unit = Unit
    suspend fun refreshAction(handle: ConversationHandle, token: ActionViewToken): Unit = Unit
    fun media(handle: ConversationHandle, scope: ConversationScope): ConversationMedia? = null
    suspend fun send(handle: ConversationHandle, intent: TextSendIntent): Result<Unit>
}

/** New chat orchestration, not Meloming Talk UX. Meloming repository/StateFlow/error conventions
 * are retained; session gateway owns credential admission and SQLite lifecycle serialization. */
class RoomConversationCoordinator(private val gateway: ConversationGateway, private val storage: ConversationStore,
                                  private val owner: CoroutineScope, private val clock: Clock = Clock.systemUTC(), private val environment: String = "qa") : ConversationRepository {
    private class Entry(val selection: ConversationSelection) {
        val identity = UUID.randomUUID().toString(); val state = MutableStateFlow(ConversationState()); val mutex = Mutex()
        var permit: ConversationPermit? = null; var scope: ConversationScope? = null; var activeCommand: RoomId? = null
        val journal = ActionJournalSlot(); val actions = MessageActionState(journal)
        val anchorStore = ScrollAnchorSlot(); val reads = MessageReadPosition(anchorStore)
        var wakeJob: Job? = null
        var retired = false
    }
    private val publication = ConversationPublicationFence()
    private val entries = ConcurrentHashMap<ConversationSelection, Entry>()
    override fun wake() {
        entries.values.forEach { entry ->
            val handle = ConversationHandle(entry.selection, entry.identity, entry.state.asStateFlow())
            synchronized(entry) { if (entry.wakeJob?.isActive != true) entry.wakeJob = owner.launch {
                try { poll(handle) } catch (_: CancellationException) { }
            } }
        }
    }
    override fun open(selection: ConversationSelection): ConversationHandle {
        val entry = publication.serial { entries.computeIfAbsent(selection) { Entry(it) } }
        val handle = ConversationHandle(selection, entry.identity, entry.state.asStateFlow())
        // A newly opened screen must not expose a cached C05 body/hint while its refresh waits.
        // The session-owned command remains alive; refresh serializes behind its completion.
        update(entry) { ConversationState(sending = entry.activeCommand != null) }
        owner.launch { refresh(handle) }
        return handle
    }
    /** Synchronous before any lifecycle await: no previous account frame survives a private-scope close. */
    fun invalidateAll() = publication.serial {
        entries.values.forEach { it.retired = true; it.actions.reset(); it.reads.select(null); it.state.value = ConversationState(loading = false) }
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
    /** Non-suspending final admission, shared by every conversation mutation. */
    private fun admission(entry: Entry, scope: ConversationScope, claim: () -> Unit = {}): () -> Unit = {
        publication.serial {
            ensure(entry)
            if (entry.scope != scope || entry.state.value.data?.scope != scope) throw CancellationException("conversation_scope_changed")
            requireNotNull(entry.permit).check()
            claim()
        }
    }
    private suspend fun <T> request(entry: Entry, action: suspend (NativeApi, String) -> T): T {
        ensure(entry); return gateway.conversationRequest(requireNotNull(entry.permit), action).also { ensure(entry) }
    }
    private suspend fun <T> commit(entry: Entry, action: suspend (() -> Unit) -> T): T {
        ensure(entry); return gateway.conversationCommit(requireNotNull(entry.permit)) { validate -> action { ensure(entry); validate() } }.also { ensure(entry) }
    }
    private fun publish(entry: Entry, data: ConversationData) {
        ensure(entry); require(entry.scope == data.scope)
        val selected = entry.actions.selection
        if (selected != null && data.messages.find { it.id.value == selected.messageId }?.let { actionSelection(entry, it) } != selected) {
            entry.actions.reset(); update(entry) { it.copy(action = null) }
        }
        update(entry) { it.copy(data = data, loading = false, error = null) }
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
        loadReadContext(entry)
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
    private fun actionScope(entry: Entry): ActionScope {
        val scope = requireNotNull(entry.scope); val member = scope.selection.membership
        return ActionScope(environment, scope.selection.account.accountId, requireNotNull(entry.permit).sessionIdentity,
            member.roomId.value, member.actorId.value, member.membershipScope.value, member.authorizationRevision.value, scope.cacheId.value)
    }
    private suspend fun <T> reads(entry: Entry, operation: () -> T): T = commit(entry) { validate ->
        storage.actionTransaction(requireNotNull(entry.scope), validate) { _, anchors -> entry.anchorStore.transaction(anchors, operation) }
    }
    private suspend fun loadReadContext(entry: Entry) {
        entry.reads.select(actionScope(entry))
        val token = requireNotNull(entry.reads.capture())
        try {
            val response = request(entry) { api, bearer -> api.messageAction(bearer, MessageReadWire.get(token.scope)) }
            if (response.status != 200) return
            entry.reads.accept(token, MessageReadWire.snapshot(response.body))
            val visible = entry.state.value.data?.messages?.map { it.id.value }?.toSet().orEmpty()
            val anchor = reads(entry) { entry.reads.restoreAnchor(token, visible) }
            update(entry) { it.copy(anchor = anchor) }
        } catch (cancelled: CancellationException) { throw cancelled }
        catch (_: Exception) { /* No read receipt is claimed; timeline remains independently authorized. */ }
    }
    override suspend fun displayed(handle: ConversationHandle, scope: ConversationScope, anchor: ScrollAnchor) {
        val entry = entry(handle)
        entry.mutex.withLock {
            if (entry.scope != scope || entry.state.value.data?.messages?.none { it.id.value == anchor.messageId } != false) return
            val token = entry.reads.capture() ?: return
            try {
                reads(entry) { entry.reads.saveAnchor(token, anchor, requireNotNull(entry.state.value.data).messages.map { it.id.value }.toSet()) }
                val permit = entry.reads.displayed(token, anchor.messageId) ?: return
                withContext(NonCancellable) {
                    owner.launch {
                        entry.mutex.withLock {
                            try {
                                val response = request(entry) { api, bearer -> api.messageActionAdmitted(bearer, permit.request(), admission(entry, scope, permit::claim)) }
                                entry.reads.finish(permit, response.status == 200, if (response.status == 200) MessageReadWire.saved(response.body) else null)
                            } catch (_: Exception) { entry.reads.finish(permit, false, null) }
                            // A fresh read context is GET-only. This visible row is never replayed automatically.
                            if (entry.reads.needsRefresh && !entry.retired && entry.scope == scope) loadReadContext(entry)
                        }
                    }
                }
            } catch (cancelled: CancellationException) { throw cancelled }
            catch (_: Exception) { update(entry) { it.copy(error = "기기에 대화 위치를 저장하지 못했어요.") } }
        }
    }
    private fun actionSelection(entry: Entry, message: ConversationMessage): ActionSelection {
        return ActionSelection(actionScope(entry),
            message.id.value, message.version.value, ActionHints(message.actions.delete, message.actions.publish), when (val content = message.content) {
                is MessageContent.Text -> "TEXT"; is MessageContent.Media -> content.type; is MessageContent.Sticker -> "STICKER"
            }, message.author == MessageAuthor.Anonymous, (message.author as? MessageAuthor.Member)?.actorId?.value)
    }
    private suspend fun <T> actions(entry: Entry, operation: () -> T): T = commit(entry) { validate ->
        storage.actionTransaction(requireNotNull(entry.scope), validate) { journal, _ -> entry.journal.transaction(journal, operation) }
    }
    private suspend fun showAction(entry: Entry, reactions: MessageReactions? = entry.state.value.action?.reactions, error: String? = null) {
        val value = actions(entry) {
            entry.actions.capture()?.let { ConversationActionState(it, entry.actions.presentation, entry.actions.blockedActions(it), entry.actions.pending != null, reactions, error) }
        }
        update(entry) { it.copy(action = value) }
    }
    override suspend fun selectAction(handle: ConversationHandle, scope: ConversationScope, message: ConversationMessage) = guarded(handle) { entry ->
        if (entry.scope != scope || entry.state.value.data?.messages?.find { it.id == message.id } != message) return@guarded
        actions(entry) { entry.actions.select(actionSelection(entry, message)) }
        showAction(entry)
    }
    override suspend fun closeAction(handle: ConversationHandle) {
        val entry = entry(handle)
        // Closing presentation cannot cancel an already admitted owner command or erase UNKNOWN.
        entry.mutex.withLock { entry.actions.reset(); update(entry) { it.copy(action = null) } }
    }
    override suspend fun runAction(handle: ConversationHandle, token: ActionViewToken, action: MessageAction, emoji: String?, reason: ReportReason?) {
        val entry = entry(handle)
        entry.mutex.withLock {
            ensure(entry)
            val message = entry.state.value.data?.messages?.find { it.id.value == token.selection.messageId } ?: return
            if (actionSelection(entry, message) != token.selection || entry.actions.capture() != token) return
            withContext(NonCancellable) {
                val permit = actions(entry) { entry.actions.begin(token, action, emoji, reason) }
                showAction(entry)
                owner.launch { dispatchAction(entry, permit) }
            }
        }
    }
    private suspend fun dispatchAction(entry: Entry, permit: ActionPermit) = entry.mutex.withLock {
        var result: ActionResult = ActionResult.Unknown
        try {
            val response = request(entry) { api, bearer ->
                api.messageActionAdmitted(bearer, MessageActionWire.mutation(permit), admission(entry, requireNotNull(entry.scope), permit::claim))
            }
            result = MessageActionWire.result(permit.record.action, response.status, response.body)
        } catch (_: Exception) { /* Durable UNKNOWN remains; mutations never replay. */ }
        try {
            if (result is ActionResult.Deleted || result is ActionResult.ActorBlocked) update(entry) { it.copy(data = null, recipients = emptyList()) }
            val effect = withContext(NonCancellable) { actions(entry) { entry.actions.finish(permit, result) } }
            if (effect is ActionEffect.ResetRoom) { reset(entry); return@withLock }
            if (effect is ActionEffect.AccessBlocked || effect is ActionEffect.Refresh) {
                publish(entry, commit(entry) { storage.current(requireNotNull(entry.scope), it) })
                // Reload the precise projection for mutable hints/reactions; receipt is independent evidence.
                refreshActionProjection(entry, permit.record.selection)
            }
            showAction(entry, (result as? ActionResult.Reacted)?.reactions ?: entry.state.value.action?.reactions)
        } catch (failure: Exception) {
            if (!entry.retired) update(entry) { it.copy(error = "요청 결과를 기기에 반영하지 못했어요. 현재 상태를 다시 확인해 주세요.") }
        }
    }
    private suspend fun refreshActionProjection(entry: Entry, selected: ActionSelection) {
        val id = RoomId(selected.messageId)
        val response = try { request(entry) { api, token -> api.getMessage(token, entry.selection.membership.roomId, id) } }
        catch (failure: ApiException) {
            if (failure.statusCode !in setOf(403, 404)) throw failure
            // Per-message denial is neither a whole-room loss nor proof of physical deletion.
            update(entry) { it.copy(data = null) }
            replaceSnapshot(entry); return
        }
        val message = ConversationDtos.message(response); require(message.id == id)
        publish(entry, commit(entry) { storage.projection(requireNotNull(entry.scope), message, it) })
    }
    override suspend fun refreshAction(handle: ConversationHandle, token: ActionViewToken) = guarded(handle) { entry ->
        if (entry.actions.capture() != token) return@guarded
        val record = entry.state.value.action?.record
        if (record?.action == MessageAction.REPORT && record.phase == ActionPhase.UNKNOWN) {
            val response = request(entry) { api, bearer -> api.messageAction(bearer, ModerationWire.recoverReport(record)) }
            if (response.status == 200) actions(entry) { entry.actions.reportStatus(token, record.id, ModerationWire.receipt(response.body)) }
            // A receipt 404 is ambiguous and keeps UNKNOWN; no report POST retry.
        }
        if (record?.action == MessageAction.PUBLISH && record.receiptId != null && record.phase in setOf(ActionPhase.PREPARING, ActionPhase.PUBLISHED)) {
            val response = request(entry) { api, bearer -> api.messageAction(bearer, MessageActionWire.publication(token.selection.scope, record.receiptId)) }
            if (response.status == 200) actions(entry) { entry.actions.publicationStatus(token, record.id, MessageActionWire.publicationResult(response.body)) }
        }
        refreshActionProjection(entry, token.selection)
        val response = request(entry) { api, bearer -> api.messageAction(bearer, MessageActionWire.reactions(token.selection)) }
        showAction(entry, if (response.status == 200) MessageActionWire.reactionResult(response.body) else null,
            if (response.status == 200) null else "현재 반응을 확인하지 못했어요.")
    }
    override fun media(handle: ConversationHandle, scope: ConversationScope): ConversationMedia? {
        val entry = entry(handle)
        if (entry.scope != scope || entry.state.value.data?.scope != scope) return null
        val permit = entry.permit ?: return null
        val originalScope = scope
        val mediaScope = object : MediaScope {
            override val presentationID = scope.cacheId.value
            override val roomId = scope.selection.membership.roomId.value
            override fun check() = publication.serial {
                ensure(entry); permit.check()
                if (entry.scope != scope || entry.state.value.data?.scope != scope) throw CancellationException("media_scope_closed")
            }
        }
        val client = MediaClient(MediaTransport { request, captured ->
            captured.check()
            gateway.conversationRequest(permit) { api, token -> captured.check(); api.media(token, request, captured) }
                .also { captured.check() }
        }, mediaScope)
        val journal = object : MediaJournal {
            override suspend fun save(scope: MediaScope, pending: PendingMedia) {
                require(scope === mediaScope); scope.check()
                val updated = gateway.conversationCommit(permit) { validate ->
                    storage.saveMedia(originalScope, pending) { scope.check(); validate() }
                    storage.current(originalScope) { scope.check(); validate() }
                }
                publication.serial { if (entry.scope == originalScope && !entry.retired) publish(entry, updated) }
            }
            override suspend fun remove(scope: MediaScope, assetId: String) {
                require(scope === mediaScope); scope.check()
                val updated = gateway.conversationCommit(permit) { validate ->
                    storage.removeMedia(originalScope, RoomId(assetId)) { scope.check(); validate() }
                    storage.current(originalScope) { scope.check(); validate() }
                }
                publication.serial { if (entry.scope == originalScope && !entry.retired) publish(entry, updated) }
            }
        }
        return ConversationMedia(client, journal)
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
                val receipt = request(entry) { api, token -> ConversationDtos.receipt(api.sendTextAdmitted(token, entry.selection.membership.roomId, intent.command, admission(entry, intent.scope)), fromLookup = false) }
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
