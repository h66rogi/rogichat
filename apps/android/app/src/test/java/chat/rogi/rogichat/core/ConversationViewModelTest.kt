package chat.rogi.rogichat.core

import chat.rogi.rogichat.core.conversation.*
import chat.rogi.rogichat.core.network.*
import chat.rogi.rogichat.core.rooms.RoomsAccountScope
import chat.rogi.rogichat.feature.conversation.ConversationViewModel
import chat.rogi.rogichat.feature.conversation.visibleQuote
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.test.*
import org.junit.Assert.*
import org.junit.Test

@OptIn(ExperimentalCoroutinesApi::class)
class ConversationViewModelTest {
    private val selection = ConversationSelection(RoomsAccountScope(OWN, 1, PARTITION),
        Membership(CONVERSATION_ID, "대화", RoomMode.GROUP, CONVERSATION_ID, RoomRole.MEMBER, SCOPE_M, SCOPE_A), ACTOR_ID)
    private val scope = ConversationScope(selection, MESSAGE_ID)
    private class Repository(val value: MutableStateFlow<ConversationState>) : ConversationRepository {
        override fun open(selection: ConversationSelection) = ConversationHandle(selection, "isolated-handle", value)
        override suspend fun refresh(handle: ConversationHandle) = Unit
        override suspend fun poll(handle: ConversationHandle) = Unit
        override suspend fun history(handle: ConversationHandle) = Unit
        override suspend fun moreRecipients(handle: ConversationHandle) = Unit
        override suspend fun reconcile(handle: ConversationHandle) = Unit
        var sent: TextSendIntent? = null
        override suspend fun send(handle: ConversationHandle, intent: TextSendIntent): Result<Unit> { sent = intent; return Result.success(Unit) }
    }
    private fun data(message: ConversationMessage) = ConversationData(scope, listOf(message), emptyList(), true, SyncCursor("events"), null, emptyList())
    @Test fun fanWithoutRecipientsSendsToRoomOwnerAndPrivateReplyRemainsExplicit() = runTest {
        val selected = selection.copy(membership = selection.membership.copy(mode = RoomMode.FAN, role = RoomRole.FAN))
        val fanScope = scope.copy(selection = selected)
        val original = ConversationDtos.message(messageProjection())
        val state = MutableStateFlow(ConversationState(loading = false, data = data(original).copy(scope = fanScope)))
        val repository = Repository(state)
        val model = ConversationViewModel(repository, selected, backgroundScope)
        runCurrent(); assertTrue(model.roomOwnerAllowed()); assertTrue(state.value.recipients.isEmpty())
        model.text("방장 수신함"); model.send(fanScope); runCurrent()
        assertEquals("ROOM_OWNER", repository.sent!!.command.intent)
        assertNull(repository.sent!!.command.recipient); assertNull(repository.sent!!.recipientRevision)
        model.reply(original, fanScope); model.text("특정 메시지 답장"); model.send(fanScope); runCurrent()
        assertEquals("PRIVATE", repository.sent!!.command.intent); assertEquals(original.replyTarget, repository.sent!!.command.recipient)
        model.clearReply(); model.text("다시 방장에게"); model.send(fanScope); runCurrent()
        assertEquals("ROOM_OWNER", repository.sent!!.command.intent)
    }
    @Test fun equalVersionProjectionReplacesQuotedBodyAndRemovedReplyClearsOriginalContentAndTarget() = runTest {
        val original = ConversationDtos.message(messageProjection())
        val state = MutableStateFlow(ConversationState(loading = false, data = data(original)))
        val model = ConversationViewModel(Repository(state), selection, backgroundScope)
        runCurrent(); model.text("작성 중 답장"); model.reply(original, scope)
        val changed = original.copy(content = MessageContent.Text("새로 허용된 본문"))
        assertEquals(changed, model.draft.value.visibleQuote(data(changed))) // No stale frame before observer dispatch.
        assertNull(model.draft.value.visibleQuote(data(changed.copy(actions = changed.actions.copy(reply = false)))))
        state.value = state.value.copy(data = data(changed)); runCurrent()
        assertEquals(original.version, model.draft.value.quote!!.version)
        assertEquals("새로 허용된 본문", (model.draft.value.quote!!.content as MessageContent.Text).text)
        state.value = state.value.copy(data = data(changed.copy(actions = changed.actions.copy(reply = false)))); runCurrent()
        assertNull(model.draft.value.quote); assertNull(model.draft.value.recipient)
        assertFalse(model.draft.value.privateMessage); assertEquals("작성 중 답장", model.draft.value.text)
    }
    @Test fun counterpartChangeNeverSilentlyRetargetsReplyAndAuthorityCloseErasesDraft() = runTest {
        val original = ConversationDtos.message(messageProjection()).copy(audience = "PRIVATE", counterpart = ACTOR_ID)
        val state = MutableStateFlow(ConversationState(loading = false, data = data(original)))
        val model = ConversationViewModel(Repository(state), selection, backgroundScope)
        runCurrent(); model.text("보내지 않은 내용"); model.reply(original, scope)
        state.value = state.value.copy(data = data(original.copy(counterpart = CONVERSATION_ID))); runCurrent()
        assertNull(model.draft.value.quote); assertNull(model.draft.value.recipient)
        state.value = ConversationState(loading = false); runCurrent()
        assertEquals("", model.draft.value.text); assertNull(model.draft.value.quote)
    }
}
