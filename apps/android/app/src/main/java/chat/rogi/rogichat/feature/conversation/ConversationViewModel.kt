package chat.rogi.rogichat.feature.conversation

import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import chat.rogi.rogichat.core.conversation.*
import chat.rogi.rogichat.core.network.*
import chat.rogi.rogichat.core.media.*
import chat.rogi.rogichat.core.messageactions.*
import kotlinx.coroutines.*
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.collect
import java.util.UUID

/** Retained only within the existing private account ViewModelStore, never a persisted route payload. */
class ConversationNavigation : ViewModel() {
    private var selection by mutableStateOf<ConversationSelection?>(null)
    var selected: ConversationSelection?
        get() = selection
        set(value) {
            if (selection?.account != value?.account) drafts.clear()
            selection = value
        }
    private val drafts = mutableMapOf<ConversationSelection, ConversationDraft>()
    fun draft(selection: ConversationSelection) = drafts[selection]
    fun save(selection: ConversationSelection, draft: ConversationDraft) {
        if (selected?.account == selection.account) drafts[selection] = draft.copy(submitting = false, uploading = false)
    }
    override fun onCleared() { drafts.clear() }
}
data class ConversationDraft(val text: String = "", val privateMessage: Boolean, val recipient: RoomId? = null,
                             val quote: ConversationMessage? = null, val recipientRevision: RoomId? = null,
                             val error: String? = null, val submitting: Boolean = false, val media: MediaContent? = null,
                             val mediaScope: ConversationScope? = null, val uploading: Boolean = false,
                             val targetNeedsReview: Boolean = false)
/** Render from the currently authorized projection even before the draft observer receives an update. */
fun ConversationDraft.visibleQuote(data: ConversationData): ConversationMessage? = quote?.let { original ->
    data.messages.find { it.id == original.id }?.takeIf { it.replyTarget != null && it.replyTarget == recipient }
}
class ConversationViewModel(private val repository: ConversationRepository, val selection: ConversationSelection,
                            private val injectedScope: CoroutineScope? = null, private val navigation: ConversationNavigation? = null) : ViewModel() {
    private val caller get() = injectedScope ?: viewModelScope
    private val handle = repository.open(selection)
    val state = handle.state
    private val mutableDraft = MutableStateFlow(navigation?.draft(selection) ?: ConversationDraft(privateMessage = false))
    val draft = mutableDraft.asStateFlow()
    private var polling: Job? = null
    private var resumedBefore = false
    init {
        caller.launch { draft.collect { navigation?.save(selection, it) } }
        caller.launch {
            state.collect { current ->
                val originalDraft = mutableDraft.value
                val draft = if (originalDraft.mediaScope != null && current.data != null && current.data.scope != originalDraft.mediaScope)
                    originalDraft.copy(media = null, mediaScope = null) else originalDraft
                if (draft !== originalDraft) mutableDraft.value = draft
                if (current.authorityClosed) {
                    mutableDraft.value = ConversationDraft(privateMessage = false)
                } else if (current.data != null && draft.quote != null) {
                    val latest = current.data.messages.find { it.id == draft.quote.id }
                    mutableDraft.value = if (latest?.replyTarget == null || latest.replyTarget != draft.recipient) {
                        draft.copy(privateMessage = false, quote = null, recipient = null, recipientRevision = null, targetNeedsReview = true,
                            error = "선택한 메시지에 지금 답장할 수 없어요.")
                    } else draft.copy(quote = latest)
                }
            }
        }
    }
    fun text(value: String) {
        if (mutableDraft.value.submitting || mutableDraft.value.uploading || mutableDraft.value.media is MediaContent.Sticker) return
        val valid = value.codePointCount(0, value.length) <= 4000 && value.toByteArray(Charsets.UTF_8).size <= 16384 && '\u0000' !in value
        mutableDraft.value = if (valid) mutableDraft.value.copy(text = value, error = null)
            else mutableDraft.value.copy(error = "메시지는 최대 4,000자까지 작성할 수 있어요.")
    }
    fun reply(message: ConversationMessage, renderedScope: ConversationScope) {
        if (mutableDraft.value.submitting || state.value.data?.scope != renderedScope || selection.membership.role != RoomRole.STREAMER) return
        val current = state.value.data?.messages?.find { it.id == message.id } ?: return
        if (current != message || current.replyTarget == null || (current.author as? MessageAuthor.Member)?.actorId == selection.membership.actorId) return
        mutableDraft.value = mutableDraft.value.copy(privateMessage = true, recipient = current.replyTarget, quote = current, recipientRevision = null, targetNeedsReview = false, error = null)
    }
    fun clearReply() { if (!mutableDraft.value.submitting) mutableDraft.value = mutableDraft.value.copy(privateMessage = false, quote = null, recipient = null, recipientRevision = null,
        media = if (mutableDraft.value.privateMessage || mutableDraft.value.targetNeedsReview) null else mutableDraft.value.media,
        mediaScope = if (mutableDraft.value.privateMessage || mutableDraft.value.targetNeedsReview) null else mutableDraft.value.mediaScope,
        targetNeedsReview = false, error = null) }
    /** A server rejection is terminal. Restoring it is an explicit new draft, never a replay of an uncertain send. */
    fun restoreRejected(record: OutboxRecord, renderedScope: ConversationScope) {
        val data = state.value.data?.takeIf { it.scope == renderedScope } ?: return
        if (record.phase != OutboxPhase.REJECTED || record.command.membership != renderedScope.selection.membership.membershipScope) return
        val existing = mutableDraft.value
        if (existing.submitting || existing.uploading || existing.text.isNotBlank() || existing.media != null) {
            mutableDraft.value = existing.copy(error = "작성 중인 메시지를 먼저 확인해 주세요."); return
        }
        val command = record.command
        val quote = command.quote?.let { id -> data.messages.find { it.id == id && it.replyTarget == command.recipient } }
        if (command.intent == "PRIVATE" && quote == null) {
            mutableDraft.value = existing.copy(error = "답장할 메시지를 다시 선택해 주세요."); return
        }
        val allowed = when (command.intent) {
            "ROOM_OWNER" -> selection.membership.mode == RoomMode.FAN && selection.membership.role == RoomRole.FAN
            "SHARED" -> selection.membership.role == RoomRole.STREAMER
            else -> quote != null && selection.membership.role == RoomRole.STREAMER
        }
        if (!allowed) { mutableDraft.value = existing.copy(error = "지금은 이 메시지를 보낼 수 없어요."); return }
        mutableDraft.value = existing.copy(text = (command.media as? MediaContent.Attachment)?.caption ?: command.text,
            privateMessage = command.intent == "PRIVATE", recipient = command.recipient, quote = quote,
            media = command.media, mediaScope = if (command.media != null) renderedScope else null, targetNeedsReview = false, error = null)
    }
    fun startPolling() {
        if (polling?.isActive == true) return
        val refreshHints = resumedBefore
        resumedBefore = true
        polling = caller.launch {
            if (refreshHints) {
                while (state.value.sending) delay(250)
                repository.refresh(handle) // C05 hints/counterpart can change without a new message version.
            }
            while (isActive) {
                try { repository.poll(handle) } catch (cancelled: CancellationException) { throw cancelled }
                delay(4000)
            }
        }
    }
    fun stopPolling() { polling?.cancel(); polling = null }
    fun refresh() { caller.launch { repository.refresh(handle) } }
    fun history() { caller.launch { repository.history(handle) } }
    suspend fun historyNow() { repository.history(handle) }
    fun reconcile() { caller.launch { repository.reconcile(handle) } }
    fun displayed(scope: ConversationScope, anchor: ScrollAnchor) { caller.launch { repository.displayed(handle, scope, anchor) } }
    fun showActions(message: ConversationMessage, scope: ConversationScope) { caller.launch {
        repository.selectAction(handle, scope, message)
        state.value.action?.token?.let { repository.refreshAction(handle, it) }
    } }
    fun react(message: ConversationMessage, scope: ConversationScope, emoji: String) { caller.launch {
        val current = state.value.data?.takeIf { it.scope == scope }?.messages?.find { it.id == message.id } ?: return@launch
        if (current != message || state.value.action?.busy == true) return@launch
        repository.selectAction(handle, scope, current)
        val token = state.value.action?.token?.takeIf { it.selection.messageId == current.id.value } ?: return@launch
        val remove = (state.value.reactions[current.id] ?: current.reactions).mine == emoji
        repository.runAction(handle, token, if (remove) MessageAction.REMOVE_REACTION else MessageAction.SET_REACTION,
            if (remove) null else emoji, null)
    } }
    fun closeActions() { caller.launch { repository.closeAction(handle) } }
    fun action(token: ActionViewToken, action: MessageAction, emoji: String? = null, reason: ReportReason? = null) {
        caller.launch { repository.runAction(handle, token, action, emoji, reason) }
    }
    fun refreshAction(token: ActionViewToken) { caller.launch { repository.refreshAction(handle, token) } }
    fun media(scope: ConversationScope) = repository.media(handle, scope)
    fun clearMedia() { if (!mutableDraft.value.uploading && !mutableDraft.value.submitting) mutableDraft.value = mutableDraft.value.copy(media = null, mediaScope = null) }
    fun mediaFailure() { mutableDraft.value = mutableDraft.value.copy(error = "첨부 파일을 준비하지 못했어요. 형식과 연결 상태를 확인해 주세요.") }
    suspend fun upload(scope: ConversationScope, file: MediaFile) {
        val adapter = media(scope) ?: return
        if (draft.value.uploading || draft.value.submitting) return
        mutableDraft.value = draft.value.copy(uploading = true, error = null)
        try {
            val ready = MediaUpload(adapter.client, adapter.journal).start(file)
            adapter.client.scope.check()
            selectMedia(scope, MediaContent.Attachment(file.kind, listOf(ready)))
        } finally { mutableDraft.value = draft.value.copy(uploading = false) }
    }
    fun recoverMedia(scope: ConversationScope, pending: PendingMedia) {
        if (draft.value.uploading || draft.value.submitting) return
        val adapter = media(scope) ?: return
        caller.launch {
            mutableDraft.value = draft.value.copy(uploading = true, error = null)
            try {
                val ready = MediaUpload(adapter.client, adapter.journal).recover(pending)
                adapter.client.scope.check(); selectMedia(scope, MediaContent.Attachment(pending.kind, listOf(ready)))
            } catch (cancelled: CancellationException) { throw cancelled }
            catch (_: Exception) { mediaFailure() }
            finally { mutableDraft.value = draft.value.copy(uploading = false) }
        }
    }
    fun selectMedia(scope: ConversationScope, content: MediaContent) {
        if (state.value.data?.scope != scope || draft.value.submitting) return
        if (content is MediaContent.Sticker && draft.value.text.isNotBlank()) return
        mutableDraft.value = draft.value.copy(media = content, mediaScope = scope, error = null)
    }
    fun send(renderedScope: ConversationScope) {
        val current = state.value.data ?: return
        val draft = mutableDraft.value
        if (current.scope != renderedScope || draft.targetNeedsReview || draft.submitting || draft.uploading || state.value.sending || draft.media != null && draft.mediaScope != renderedScope) return
        val text = try { if (draft.media == null) TextCommand.normalizeText(draft.text) else "" } catch (_: Exception) {
            mutableDraft.value = draft.copy(error = "메시지는 공백을 제외해 입력하고, 4,000자 이내로 작성해 주세요."); return
        }
        val media = try {
            if (draft.media is MediaContent.Attachment) draft.media.withCaption(if (draft.text.isBlank()) null else TextCommand.normalizeText(draft.text))
            else draft.media
        } catch (_: Exception) {
            mutableDraft.value = draft.copy(error = "메시지는 최대 4,000자까지 작성할 수 있어요."); return
        }
        if (draft.privateMessage && (selection.membership.role != RoomRole.STREAMER || draft.quote == null || draft.recipient == null)) { mutableDraft.value = draft.copy(error = "답장할 메시지를 다시 선택해 주세요."); return }
        val membership = renderedScope.selection.membership
        val intent = when {
            draft.privateMessage -> "PRIVATE"
            membership.mode == RoomMode.FAN && membership.role == RoomRole.FAN -> "ROOM_OWNER"
            else -> "SHARED"
        }
        val command = TextCommand(RoomId(UUID.randomUUID().toString()), membership.membershipScope,
            intent, draft.recipient.takeIf { draft.privateMessage }, draft.quote?.id, text, media)
        val sendIntent = TextSendIntent(renderedScope, command, draft.recipientRevision)
        mutableDraft.value = draft.copy(submitting = true, error = null)
        caller.launch {
            try {
                val result = repository.send(handle, sendIntent)
                mutableDraft.value = if (result.isSuccess) {
                    if (draft.quote != null) ConversationDraft(privateMessage = false)
                    else draft.copy(text = "", submitting = false, error = null, media = null, mediaScope = null)
                }
                else draft.copy(submitting = false, error = "메시지를 보낼 수 없었어요. 내용과 연결 상태를 확인해 주세요.")
            } finally { if (mutableDraft.value.submitting) mutableDraft.value = mutableDraft.value.copy(submitting = false) }
        }
    }
    override fun onCleared() { stopPolling(); navigation?.save(selection, mutableDraft.value) }
}
