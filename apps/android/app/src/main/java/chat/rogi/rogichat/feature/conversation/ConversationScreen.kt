package chat.rogi.rogichat.feature.conversation

import androidx.compose.foundation.layout.*
import androidx.compose.foundation.interaction.collectIsDraggedAsState
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.lazy.rememberLazyListState
import androidx.lifecycle.repeatOnLifecycle
import kotlinx.coroutines.flow.distinctUntilChanged
import kotlinx.coroutines.flow.collect
import chat.rogi.rogichat.core.messageactions.ScrollAnchor
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import androidx.lifecycle.Lifecycle
import androidx.lifecycle.LifecycleEventObserver
import androidx.lifecycle.compose.LocalLifecycleOwner
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import chat.rogi.rogichat.core.conversation.*
import chat.rogi.rogichat.core.media.*
import chat.rogi.rogichat.feature.media.*
import chat.rogi.rogichat.feature.messageactions.*
import chat.rogi.rogichat.core.design.ScreenStatus
import chat.rogi.rogichat.core.network.RoomMode
import java.time.ZoneId
import java.time.format.DateTimeFormatter

/** Native conversation UX is new. Navigation, theme, settings and lifecycle primitives remain source-derived. */
@OptIn(ExperimentalLayoutApi::class, ExperimentalMaterial3Api::class)
@Composable
fun ConversationScreen(model: ConversationViewModel) {
    val state by model.state.collectAsStateWithLifecycle()
    val draft by model.draft.collectAsStateWithLifecycle()
    val owner = LocalLifecycleOwner.current
    DisposableEffect(owner, model) {
        val observer = LifecycleEventObserver { _, event ->
            if (event == Lifecycle.Event.ON_RESUME) model.startPolling()
            if (event == Lifecycle.Event.ON_PAUSE || event == Lifecycle.Event.ON_STOP) model.stopPolling()
        }
        owner.lifecycle.addObserver(observer)
        if (owner.lifecycle.currentState.isAtLeast(Lifecycle.State.RESUMED)) model.startPolling()
        onDispose { owner.lifecycle.removeObserver(observer); model.stopPolling() }
    }
    val data = state.data
    when {
        state.loading && data == null -> ScreenStatus("대화를 불러오는 중", "잠시만 기다려 주세요.", loading = true)
        data == null -> ScreenStatus("대화를 확인하지 못했어요", state.error ?: "대화 목록에서 참여 상태를 다시 확인해 주세요.", onRetry = model::refresh)
        else -> Column(Modifier.fillMaxSize().imePadding()) {
            state.action?.let { action -> ModalBottomSheet(onDismissRequest = model::closeActions) {
                Column(Modifier.fillMaxWidth().padding(20.dp)) {
                    action.error?.let { Text(it, color = MaterialTheme.colorScheme.error) }
                    MessageActionsPanel(action.token, action.record, action.busy, action.reactions, action.unavailable,
                        { token, command, emoji -> model.action(token, command, emoji) }, model::refreshAction)
                    MessageModerationPanel(action.token, action.busy, action.unavailable) { token, command, reason -> model.action(token, command, reason = reason) }
                }
            } }
            val listState = rememberLazyListState()
            val currentData by rememberUpdatedState(data)
            val dragging by listState.interactionSource.collectIsDraggedAsState()
            var userInteracted by remember(data.scope) { mutableStateOf(false) }
            LaunchedEffect(dragging) { if (dragging) userInteracted = true }
            var anchorApplied by remember(data.scope) { mutableStateOf(false) }
            LaunchedEffect(data.scope, state.anchor) {
                val anchor = state.anchor
                if (!anchorApplied && anchor != null) {
                    val pendingCount = data.outbox.count { it.messageId == null || data.messages.none { message -> message.id == it.messageId } }
                    val index = data.messages.asReversed().indexOfFirst { it.id.value == anchor.messageId }
                    if (index >= 0) { anchorApplied = true; listState.scrollToItem(pendingCount + index, anchor.offset) }
                }
            }
            LaunchedEffect(data.scope, owner) {
                owner.lifecycle.repeatOnLifecycle(Lifecycle.State.RESUMED) {
                    snapshotFlow {
                        val ids = currentData.messages.map { it.id.value }.toSet()
                        listState.layoutInfo.visibleItemsInfo.firstOrNull { it.key.toString() in ids }?.let {
                            ScrollAnchor(it.key.toString(), (-it.offset).coerceAtLeast(0))
                        }
                    }.distinctUntilChanged().collect { anchor ->
                        // Restoring a saved position never replays a read marker.
                        if (anchor != null && userInteracted) model.displayed(data.scope, anchor)
                    }
                }
            }
            val visibleQuote = draft.visibleQuote(data)
            val media = remember(data.scope) { model.media(data.scope) }
            var stickers by remember(data.scope) { mutableStateOf(false) }
            if (stickers && media != null) ModalBottomSheet(onDismissRequest = { stickers = false }) {
                Box(Modifier.fillMaxWidth().heightIn(max = 480.dp).padding(16.dp)) {
                    StickerPicker(media.client) { selected -> model.selectMedia(data.scope, selected); stickers = false }
                }
            }
            state.error?.let { error -> Surface(color = MaterialTheme.colorScheme.errorContainer) {
                Column(Modifier.fillMaxWidth().padding(horizontal = 16.dp, vertical = 8.dp)) {
                    Text(error, style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onErrorContainer)
                    TextButton(onClick = model::refresh, enabled = !state.sending) { Text("다시 확인") }
                }
            } }
            LazyColumn(Modifier.weight(1f).fillMaxWidth(), state = listState, reverseLayout = true, contentPadding = PaddingValues(horizontal = 16.dp, vertical = 12.dp),
                verticalArrangement = Arrangement.spacedBy(10.dp)) {
                val pending = data.outbox.filter { record -> record.command.membership == data.scope.selection.membership.membershipScope &&
                    record.phase !in setOf(OutboxPhase.DELETED, OutboxPhase.PARKED) &&
                    (record.messageId == null || data.messages.none { it.id == record.messageId }) }
                items(pending.asReversed(), key = { "pending-${it.command.clientMessageId.value}" }) { record ->
                    Column(Modifier.fillMaxWidth(), horizontalAlignment = Alignment.End) {
                        Surface(shape = RoundedCornerShape(16.dp), color = MaterialTheme.colorScheme.surfaceVariant) {
                            Text(if (record.phase == OutboxPhase.COMMITTED) "메시지 저장이 확인되었어요." else record.command.media?.let { if (it is MediaContent.Sticker) "스티커" else "첨부 파일" } ?: record.command.text, Modifier.padding(12.dp), style = MaterialTheme.typography.bodyLarge)
                        }
                        Text(when (record.phase) {
                            OutboxPhase.PREPARED, OutboxPhase.SENDING -> if (state.sending) "전송 중" else "전송 결과 확인 필요"
                            OutboxPhase.COMMITTED -> if (record.errorCode == "PROJECTION_UNAVAILABLE") "저장됨 · 현재 내용 확인 불가" else "저장됨 · 내용 확인 필요"
                            OutboxPhase.REJECTED -> "전송되지 않음"
                            OutboxPhase.PARKED -> "이전 참여 상태의 요청 · 다시 보내지 않음"
                            else -> "전송 결과 확인 필요"
                        }, style = MaterialTheme.typography.labelSmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
                        if (record.phase in setOf(OutboxPhase.UNKNOWN, OutboxPhase.COMMITTED, OutboxPhase.SENDING, OutboxPhase.PREPARED))
                            TextButton(onClick = model::reconcile, enabled = !state.sending) { Text("결과 확인") }
                    }
                }
                items(data.messages.asReversed(), key = { it.id.value }) { message ->
                    MessageBubble(message, (message.author as? MessageAuthor.Member)?.actorId == model.selection.membership.actorId, media?.client,
                        onReply = { model.reply(message, data.scope) }, onActions = { model.showActions(message, data.scope) })
                }
                if (data.historyCursor != null) item { TextButton(onClick = model::history, modifier = Modifier.fillMaxWidth()) { Text("이전 메시지 보기") } }
                if (data.messages.isEmpty() && pending.isEmpty()) item {
                    Text("아직 표시할 메시지가 없어요.", Modifier.fillMaxWidth().padding(vertical = 24.dp), style = MaterialTheme.typography.bodyMedium,
                        color = MaterialTheme.colorScheme.onSurfaceVariant)
                }
            }
            HorizontalDivider()
            Column(Modifier.fillMaxWidth().padding(horizontal = 16.dp, vertical = 8.dp), verticalArrangement = Arrangement.spacedBy(6.dp)) {
                if (model.selection.membership.mode == RoomMode.FAN && !model.mustPrivate()) FlowRow(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                    FilterChip(selected = !draft.privateMessage, onClick = { model.choosePrivate(false) }, label = { Text("전체 대화") }, enabled = !draft.submitting)
                    FilterChip(selected = draft.privateMessage, onClick = { model.choosePrivate(true) }, label = { Text("개인 대화") }, enabled = !draft.submitting)
                }
                visibleQuote?.let { quote ->
                    Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically) {
                        Text("답장: ${quote.textSummary()}", Modifier.weight(1f), maxLines = 2, style = MaterialTheme.typography.bodySmall)
                        TextButton(onClick = model::clearReply, enabled = !draft.submitting) { Text("취소") }
                    }
                }
                if (draft.privateMessage && draft.quote == null) {
                    var choosing by remember { mutableStateOf(false) }
                    Box {
                        TextButton(onClick = { choosing = true }, enabled = !draft.submitting) {
                            Text(state.recipients.find { it.actorId == draft.recipient }?.nickname?.let { "$it 님에게" } ?: "받는 사람 선택")
                        }
                        DropdownMenu(expanded = choosing, onDismissRequest = { choosing = false }) {
                            state.recipients.forEach { recipient -> DropdownMenuItem(text = { Text(recipient.nickname) }, onClick = {
                                choosing = false; model.recipient(recipient, state.recipientRevision)
                            }) }
                            if (state.recipients.isEmpty()) DropdownMenuItem(text = { Text("지금 선택할 수 있는 사람이 없어요.") }, onClick = {}, enabled = false)
                            if (state.recipientNext != null) DropdownMenuItem(text = { Text("더 보기") }, onClick = model::moreRecipients)
                        }
                    }
                }
                if (media != null) {
                    if (draft.media != null) Row(verticalAlignment = Alignment.CenterVertically) {
                        Text(if (draft.media is MediaContent.Sticker) "스티커 선택됨" else "첨부 파일 준비됨", Modifier.weight(1f))
                        TextButton(onClick = model::clearMedia, enabled = !draft.submitting && !draft.uploading) { Text("첨부 취소") }
                    }
                    if (draft.uploading) LinearProgressIndicator(Modifier.fillMaxWidth())
                    FlowRow(horizontalArrangement = Arrangement.spacedBy(4.dp)) {
                        val enabled = !draft.submitting && !draft.uploading && draft.text.isEmpty() && draft.media == null
                        MediaPicker(MediaKind.PHOTO, enabled, media.client.scope, { model.upload(data.scope, it) }, { model.mediaFailure() })
                        MediaPicker(MediaKind.VIDEO, enabled, media.client.scope, { model.upload(data.scope, it) }, { model.mediaFailure() })
                        TextButton(onClick = { stickers = true }, enabled = enabled) { Text("스티커") }
                    }
                    data.pendingMedia.forEach { pending ->
                        TextButton(onClick = { model.recoverMedia(data.scope, pending) }, enabled = !draft.uploading && !draft.submitting && draft.text.isEmpty()) {
                            Text("${if (pending.kind == MediaKind.VIDEO) "동영상" else "사진"} 처리 상태 확인")
                        }
                    }
                }
                OutlinedTextField(value = draft.text, onValueChange = model::text, modifier = Modifier.fillMaxWidth(), maxLines = 5,
                    enabled = !draft.submitting && !draft.uploading && draft.media == null, placeholder = { Text(if (draft.privateMessage) "개인 메시지" else "메시지") },
                    supportingText = draft.error?.let { { Text(it) } }, isError = draft.error != null)
                Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.End) {
                    Button(onClick = { model.send(data.scope) }, enabled = !state.sending && !draft.submitting && !draft.uploading && (draft.text.isNotBlank() || draft.media != null) && (draft.quote == null || visibleQuote != null)) { Text("보내기") }
                }
            }
        }
    }
}
private fun ConversationMessage.textSummary() = when (val content = content) {
    is MessageContent.Text -> content.text ?: "본문을 표시할 수 없어요."
    is MessageContent.Media -> if (content.type == "PHOTO") "사진 ${content.attachments.size}개" else "동영상"
    is MessageContent.Sticker -> "스티커"
}
@OptIn(ExperimentalLayoutApi::class)
@Composable
private fun MessageBubble(message: ConversationMessage, own: Boolean, media: MediaClient?, onReply: () -> Unit, onActions: () -> Unit) {
    Column(Modifier.fillMaxWidth(), horizontalAlignment = if (own) Alignment.End else Alignment.Start) {
        val author = when (val author = message.author) { MessageAuthor.Anonymous -> "익명"; is MessageAuthor.Member -> author.nickname }
        Text(author + if (message.audience == "PRIVATE") " · 개인 대화" else "", style = MaterialTheme.typography.labelMedium,
            color = MaterialTheme.colorScheme.onSurfaceVariant)
        Surface(shape = RoundedCornerShape(16.dp), color = if (own) MaterialTheme.colorScheme.primaryContainer else MaterialTheme.colorScheme.surfaceVariant) {
            Column(Modifier.padding(12.dp)) {
                message.quote?.let { quote -> Text(quote.text, style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant); HorizontalDivider(Modifier.padding(vertical = 6.dp)) }
                when (val content = message.content) {
                    is MessageContent.Text -> Text(message.textSummary(), style = MaterialTheme.typography.bodyLarge)
                    is MessageContent.Media -> if (media != null) content.attachments.forEach { attachment ->
                        AuthorizedMedia(media, attachment.assetId.value,
                            MediaAccess.Message(requireNotNull(media.scope.roomId), message.id.value,
                                if (content.type == "VIDEO") MediaVariant.video else MediaVariant.image), Modifier.widthIn(max = 320.dp).heightIn(max = 360.dp))
                    } else Text(message.textSummary())
                    is MessageContent.Sticker -> if (media != null) AuthorizedMedia(media, content.assetId.value,
                        MediaAccess.Sticker(requireNotNull(media.scope.roomId), content.stickerId.value, message.id.value), Modifier.size(120.dp))
                        else Text("스티커")
                }
            }
        }
        FlowRow(horizontalArrangement = Arrangement.spacedBy(4.dp)) {
            Text(DateTimeFormatter.ofPattern("M월 d일 HH:mm").withZone(ZoneId.systemDefault()).format(message.createdAt), style = MaterialTheme.typography.labelSmall,
                color = MaterialTheme.colorScheme.onSurfaceVariant)
            if (message.replyTarget != null) TextButton(onClick = onReply) { Text("답장") }
            TextButton(onClick = onActions) { Text("메시지 메뉴") }
        }
    }
}
