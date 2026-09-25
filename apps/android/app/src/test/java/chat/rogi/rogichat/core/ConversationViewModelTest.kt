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
    @Test fun fanWithoutRecipientsSendsOnlyToOwnerAndCannotStartPrivateReply() = runTest {
        val selected = selection.copy(membership = selection.membership.copy(mode = RoomMode.FAN, role = RoomRole.FAN))
        val fanScope = scope.copy(selection = selected)
        val original = ConversationDtos.message(messageProjection())
        val state = MutableStateFlow(ConversationState(loading = false, data = data(original).copy(scope = fanScope)))
        val repository = Repository(state)
        val model = ConversationViewModel(repository, selected, backgroundScope)
        runCurrent(); assertTrue(state.value.recipients.isEmpty())
        model.text("방장에게"); model.send(fanScope); runCurrent()
        assertEquals("ROOM_OWNER", repository.sent!!.command.intent)
        assertNull(repository.sent!!.command.recipient); assertNull(repository.sent!!.recipientRevision)
        model.reply(original, fanScope); assertNull(model.draft.value.quote)
        model.text("계속 방장에게"); model.send(fanScope); runCurrent()
        assertEquals("ROOM_OWNER", repository.sent!!.command.intent)
    }
    @Test fun fanRoomOwnerSendsToFansUnlessReplyingToSelectedFan() = runTest {
        val selected = selection.copy(membership = selection.membership.copy(mode = RoomMode.FAN, role = RoomRole.STREAMER))
        val ownerScope = scope.copy(selection = selected)
        val fanMessage = ConversationDtos.message(messageProjection()).copy(audience = "PRIVATE", counterpart = ACTOR_ID)
        val state = MutableStateFlow(ConversationState(loading = false, data = data(fanMessage).copy(scope = ownerScope)))
        val repository = Repository(state)
        val model = ConversationViewModel(repository, selected, backgroundScope)
        runCurrent()
        model.text("모든 팬에게"); model.send(ownerScope); runCurrent()
        assertEquals("SHARED", repository.sent!!.command.intent)
        assertNull(repository.sent!!.command.recipient)
        model.reply(fanMessage, ownerScope)
        model.text("선택한 팬에게"); model.send(ownerScope); runCurrent()
        assertEquals("PRIVATE", repository.sent!!.command.intent)
        assertEquals(ACTOR_ID, repository.sent!!.command.recipient)
        assertEquals(fanMessage.id, repository.sent!!.command.quote)
        model.text("다시 모든 팬에게"); model.send(ownerScope); runCurrent()
        assertEquals("SHARED", repository.sent!!.command.intent)
    }
    @Test fun equalVersionProjectionReplacesQuotedBodyAndRemovedReplyClearsOriginalContentAndTarget() = runTest {
        val original = ConversationDtos.message(messageProjection())
        val selected = selection.copy(membership = selection.membership.copy(mode = RoomMode.FAN, role = RoomRole.STREAMER))
        val streamerScope = scope.copy(selection = selected)
        val state = MutableStateFlow(ConversationState(loading = false, data = data(original).copy(scope = streamerScope)))
        val model = ConversationViewModel(Repository(state), selected, backgroundScope)
        runCurrent(); model.text("작성 중 답장"); model.reply(original, streamerScope)
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
        val selected = selection.copy(membership = selection.membership.copy(mode = RoomMode.FAN, role = RoomRole.STREAMER))
        val streamerScope = scope.copy(selection = selected)
        val state = MutableStateFlow(ConversationState(loading = false, data = data(original).copy(scope = streamerScope)))
        val model = ConversationViewModel(Repository(state), selected, backgroundScope)
        runCurrent(); model.text("보내지 않은 내용"); model.reply(original, streamerScope)
        state.value = state.value.copy(data = data(original.copy(counterpart = CONVERSATION_ID))); runCurrent()
        assertNull(model.draft.value.quote); assertNull(model.draft.value.recipient)
        state.value = ConversationState(loading = false, authorityClosed = true); runCurrent()
        assertEquals("", model.draft.value.text); assertNull(model.draft.value.quote)
    }
}
