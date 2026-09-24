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
class ConversationNavigation : ViewModel() { var selected by mutableStateOf<ConversationSelection?>(null) }
data class ConversationDraft(val text: String = "", val privateMessage: Boolean, val recipient: RoomId? = null,
                             val quote: ConversationMessage? = null, val recipientRevision: RoomId? = null,
                             val error: String? = null, val submitting: Boolean = false, val media: MediaContent? = null,
                             val mediaScope: ConversationScope? = null, val uploading: Boolean = false)
/** Render from the currently authorized projection even before the draft observer receives an update. */
fun ConversationDraft.visibleQuote(data: ConversationData): ConversationMessage? = quote?.let { original ->
    data.messages.find { it.id == original.id }?.takeIf { it.replyTarget != null && it.replyTarget == recipient }
}
class ConversationViewModel(private val repository: ConversationRepository, val selection: ConversationSelection,
                            private val injectedScope: CoroutineScope? = null) : ViewModel() {
    private val caller get() = injectedScope ?: viewModelScope
    private val handle = repository.open(selection)
    val state = handle.state
    private val mutableDraft = MutableStateFlow(ConversationDraft(privateMessage = false))
    val draft = mutableDraft.asStateFlow()
    private var polling: Job? = null
    private var resumedBefore = false
    init {
        caller.launch {
            state.collect { current ->
                val originalDraft = mutableDraft.value
                val draft = if (originalDraft.mediaScope != null && current.data?.scope != originalDraft.mediaScope)
                    originalDraft.copy(media = null, mediaScope = null) else originalDraft
                if (draft !== originalDraft) mutableDraft.value = draft
                if (current.data == null && !current.loading) {
                    mutableDraft.value = ConversationDraft(privateMessage = false)
                } else if (current.data != null && draft.quote != null) {
                    val latest = current.data.messages.find { it.id == draft.quote.id }
                    mutableDraft.value = if (latest?.replyTarget == null || latest.replyTarget != draft.recipient) {
                        draft.copy(privateMessage = false, quote = null, recipient = null, recipientRevision = null,
                            error = "선택한 메시지에 지금 답장할 수 없어요.")
                    } else draft.copy(quote = latest)
                }
            }
        }
    }
    fun text(value: String) {
        if (!mutableDraft.value.submitting && !mutableDraft.value.uploading && mutableDraft.value.media == null) mutableDraft.value = mutableDraft.value.copy(text = value.substring(0, value.offsetByCodePoints(0, minOf(20000, value.codePointCount(0, value.length)))), error = null)
    }
    fun reply(message: ConversationMessage, renderedScope: ConversationScope) {
        if (mutableDraft.value.submitting || state.value.data?.scope != renderedScope || selection.membership.role != RoomRole.STREAMER) return
        val current = state.value.data?.messages?.find { it.id == message.id } ?: return
        if (current != message || current.replyTarget == null || (current.author as? MessageAuthor.Member)?.actorId == selection.membership.actorId) return
        mutableDraft.value = mutableDraft.value.copy(privateMessage = true, recipient = current.replyTarget, quote = current, recipientRevision = null, error = null)
    }
    fun clearReply() { if (!mutableDraft.value.submitting) mutableDraft.value = mutableDraft.value.copy(privateMessage = false, quote = null, recipient = null, recipientRevision = null) }
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
    fun reconcile() { caller.launch { repository.reconcile(handle) } }
    fun displayed(scope: ConversationScope, anchor: ScrollAnchor) { caller.launch { repository.displayed(handle, scope, anchor) } }
    fun showActions(message: ConversationMessage, scope: ConversationScope) { caller.launch { repository.selectAction(handle, scope, message) } }
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
        if (draft.value.uploading || draft.value.submitting || draft.value.text.isNotEmpty()) return
        mutableDraft.value = draft.value.copy(uploading = true, error = null)
        try {
            val ready = MediaUpload(adapter.client, adapter.journal).start(file)
            adapter.client.scope.check()
            selectMedia(scope, MediaContent.Attachment(file.kind, listOf(ready)))
        } finally { mutableDraft.value = draft.value.copy(uploading = false) }
    }
    fun recoverMedia(scope: ConversationScope, pending: PendingMedia) {
        if (draft.value.uploading || draft.value.submitting || draft.value.text.isNotEmpty()) return
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
        if (state.value.data?.scope != scope || draft.value.submitting || draft.value.text.isNotEmpty()) return
        mutableDraft.value = draft.value.copy(media = content, mediaScope = scope, error = null)
    }
    fun send(renderedScope: ConversationScope) {
        val current = state.value.data ?: return
        val draft = mutableDraft.value
        if (current.scope != renderedScope || draft.submitting || draft.uploading || state.value.sending || draft.media != null && draft.mediaScope != renderedScope) return
        val text = try { if (draft.media == null) TextCommand.normalizeText(draft.text) else "" } catch (_: Exception) {
            mutableDraft.value = draft.copy(error = "메시지는 공백을 제외해 입력하고, 4,000자 이내로 작성해 주세요."); return
        }
        if (draft.privateMessage && (selection.membership.role != RoomRole.STREAMER || draft.quote == null || draft.recipient == null)) { mutableDraft.value = draft.copy(error = "답장할 메시지를 다시 선택해 주세요."); return }
        val command = TextCommand(RoomId(UUID.randomUUID().toString()), renderedScope.selection.membership.membershipScope,
            if (draft.privateMessage) "PRIVATE" else "SHARED", draft.recipient.takeIf { draft.privateMessage }, draft.quote?.id, text, draft.media)
        val intent = TextSendIntent(renderedScope, command, draft.recipientRevision)
        mutableDraft.value = draft.copy(submitting = true, error = null)
        caller.launch {
            try {
                val result = repository.send(handle, intent)
                mutableDraft.value = if (result.isSuccess) {
                    if (draft.quote != null) ConversationDraft(privateMessage = false)
                    else draft.copy(text = "", submitting = false, error = null, media = null, mediaScope = null)
                }
                else draft.copy(submitting = false, error = "메시지를 보내기 위한 저장을 완료하지 못했어요. 다시 확인해 주세요.")
            } finally { if (mutableDraft.value.submitting) mutableDraft.value = mutableDraft.value.copy(submitting = false) }
        }
    }
    override fun onCleared() { stopPolling(); mutableDraft.value = ConversationDraft(privateMessage = false) }
}
