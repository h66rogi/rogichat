package chat.rogi.rogichat.feature.conversation

import androidx.compose.foundation.layout.*
import androidx.compose.foundation.clickable
import androidx.compose.foundation.background
import androidx.compose.foundation.interaction.collectIsDraggedAsState
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.LazyListState
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.lazy.itemsIndexed
import androidx.lifecycle.repeatOnLifecycle
import kotlinx.coroutines.flow.distinctUntilChanged
import kotlinx.coroutines.flow.collect
import kotlinx.coroutines.launch
import chat.rogi.rogichat.core.messageactions.ScrollAnchor
import chat.rogi.rogichat.core.messageactions.MessageReactions
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.*
import androidx.compose.ui.window.Dialog
import androidx.compose.ui.window.DialogProperties
import androidx.compose.ui.graphics.Color
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.draw.clip
import androidx.compose.ui.Modifier
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
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
import chat.rogi.rogichat.core.network.RoomRole
import chat.rogi.rogichat.core.network.SyncCursor
import com.adamglin.PhosphorIcons
import com.adamglin.phosphoricons.Regular
import com.adamglin.phosphoricons.regular.Plus
import com.adamglin.phosphoricons.regular.Smiley
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
            var showActions by remember(data.scope) { mutableStateOf(false) }
            var openedMedia by remember(data.scope) { mutableStateOf<OpenedMessageMedia?>(null) }
            val mediaClient = remember(data.scope) { model.media(data.scope)?.client }
            openedMedia?.let { opened ->
                if (mediaClient != null && data.messages.any { it.id.value == opened.messageId &&
                    (it.content as? MessageContent.Media)?.attachments?.any { attachment -> attachment.assetId.value == opened.assetId } == true }) {
                    Dialog(onDismissRequest = { openedMedia = null }, properties = DialogProperties(usePlatformDefaultWidth = false)) {
                        Column(Modifier.fillMaxSize().background(Color.Black)) {
                            TextButton(onClick = { openedMedia = null }, modifier = Modifier.align(Alignment.End)) { Text("닫기", color = Color.White) }
                            AuthorizedMedia(mediaClient, opened.assetId,
                                MediaAccess.Message(requireNotNull(mediaClient.scope.roomId), opened.messageId, opened.variant),
                                Modifier.fillMaxWidth().weight(1f), zoomable = opened.variant == MediaVariant.image)
                        }
                    }
                }
            }
            state.action?.takeIf { showActions }?.let { action -> ModalBottomSheet(onDismissRequest = { showActions = false; model.closeActions() }) {
                Column(Modifier.fillMaxWidth().padding(20.dp)) {
                    action.error?.let { Text(it, color = MaterialTheme.colorScheme.error) }
                    MessageActionsPanel(action.token, action.record, action.busy, action.reactions, action.unavailable,
                        { token, command, emoji -> model.action(token, command, emoji) }, model::refreshAction)
                    MessageModerationPanel(action.token, action.busy, action.unavailable) { token, command, reason -> model.action(token, command, reason = reason) }
                }
            } }
            val listState = remember(data.scope) { LazyListState() }
            val visiblePending = data.outbox.filter { record ->
                record.command.membership == data.scope.selection.membership.membershipScope &&
                    record.phase !in setOf(OutboxPhase.DELETED, OutboxPhase.PARKED) &&
                    (record.messageId == null || data.messages.none { it.id == record.messageId })
            }
            val scrollScope = rememberCoroutineScope()
            var previousTail by remember(data.scope) { mutableStateOf<String?>(null) }
            var newCount by remember(data.scope) { mutableIntStateOf(0) }
            var newVisibleArrival by remember(data.scope) { mutableStateOf(false) }
            LaunchedEffect(data.scope, data.messages) {
                val prior = previousTail
                val added = if (prior == null) 0 else data.messages.indexOfLast { it.id.value == prior }.let { index ->
                    if (index < 0) 0 else data.messages.size - index - 1
                }
                if (added > 0 && listState.firstVisibleItemIndex > 1) newCount += added
                if (listState.firstVisibleItemIndex <= 1) {
                    newCount = 0
                    if (added > 0) newVisibleArrival = true
                }
                previousTail = data.messages.lastOrNull()?.id?.value
            }
            val currentData by rememberUpdatedState(data)
            val dragging by listState.interactionSource.collectIsDraggedAsState()
            var userInteracted by remember(data.scope) { mutableStateOf(false) }
            var quoteTarget by remember(data.scope) { mutableStateOf<String?>(null) }
            var quoteNotice by remember(data.scope) { mutableStateOf<String?>(null) }
            var attemptedQuoteCursor by remember(data.scope) { mutableStateOf<SyncCursor?>(null) }
            LaunchedEffect(dragging) {
                if (dragging) {
                    userInteracted = true
                    quoteTarget = null
                }
            }
            var anchorApplied by remember(data.scope) { mutableStateOf(false) }
            LaunchedEffect(data.scope, state.anchor, visiblePending.size) {
                val anchor = state.anchor
                if (!anchorApplied && !userInteracted && anchor != null) {
                    val pendingCount = visiblePending.size
                    val index = data.messages.asReversed().indexOfFirst { it.id.value == anchor.messageId }
                    if (index >= 0) { anchorApplied = true; listState.scrollToItem(pendingCount + index, anchor.offset) }
                }
            }
            LaunchedEffect(data.scope, quoteTarget, data.messages, data.historyCursor, state.error, visiblePending.size) {
                val target = quoteTarget ?: return@LaunchedEffect
                val pendingCount = visiblePending.size
                val index = data.messages.asReversed().indexOfFirst { it.id.value == target }
                when {
                    index >= 0 -> { listState.animateScrollToItem(pendingCount + index); quoteTarget = null }
                    data.historyCursor != null && state.error == null && attemptedQuoteCursor != data.historyCursor -> {
                        val requested = data.historyCursor
                        model.historyNow()
                        attemptedQuoteCursor = requested
                        if (quoteTarget == target && model.state.value.data?.historyCursor == requested &&
                            model.state.value.data?.messages?.none { it.id.value == target } == true) {
                            quoteNotice = "원본 메시지를 볼 수 없어요."; quoteTarget = null
                        }
                    }
                    else -> { quoteNotice = "원본 메시지를 볼 수 없어요."; quoteTarget = null }
                }
            }
            var positionedUnreadId by remember(data.scope) { mutableStateOf<String?>(null) }
            var initialUnreadPositioned by remember(data.scope) { mutableStateOf(false) }
            var attemptedUnreadCursor by remember(data.scope) { mutableStateOf<SyncCursor?>(null) }
            var searchedUnreadId by remember(data.scope) { mutableStateOf<String?>(null) }
            LaunchedEffect(data.scope, state.firstUnreadMessageId, data.messages, data.historyCursor, userInteracted, anchorApplied, visiblePending.size) {
                val boundary = state.firstUnreadMessageId ?: return@LaunchedEffect
                if (searchedUnreadId != boundary) {
                    searchedUnreadId = boundary
                    attemptedUnreadCursor = null
                }
                if (positionedUnreadId == boundary || userInteracted || anchorApplied ||
                    state.anchor?.messageId?.let { saved -> data.messages.any { it.id.value == saved } } == true || quoteTarget != null) return@LaunchedEffect
                val pendingCount = visiblePending.size
                val index = data.messages.asReversed().indexOfFirst { it.id.value == boundary }
                if (index >= 0) {
                    listState.scrollToItem(pendingCount + index)
                    positionedUnreadId = boundary
                    anchorApplied = true
                    initialUnreadPositioned = true
                } else if (data.historyCursor != null && state.error == null && attemptedUnreadCursor != data.historyCursor) {
                    val requested = data.historyCursor
                    model.historyNow()
                    attemptedUnreadCursor = requested
                } else if (data.historyCursor == null) positionedUnreadId = boundary
            }
            LaunchedEffect(data.scope, owner) {
                owner.lifecycle.repeatOnLifecycle(Lifecycle.State.RESUMED) {
                    snapshotFlow {
                        val ids = currentData.messages.map { it.id.value }.toSet()
                        val anchor = listState.layoutInfo.visibleItemsInfo.firstOrNull { it.key.toString() in ids }?.let {
                            ScrollAnchor(it.key.toString(), (-it.offset).coerceAtLeast(0))
                        }
                        anchor to (userInteracted || initialUnreadPositioned || newVisibleArrival)
                    }.distinctUntilChanged().collect { (anchor, readEligible) ->
                        // Restoring a saved position never replays a read marker.
                        if (anchor != null && readEligible) model.displayed(data.scope, anchor)
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
            quoteNotice?.let { Text(it, Modifier.fillMaxWidth().padding(horizontal = 16.dp, vertical = 4.dp),
                style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant) }
            val awayFromLatest by remember(listState) { derivedStateOf { listState.firstVisibleItemIndex > 1 } }
            if (newCount > 0 || awayFromLatest) TextButton(
                onClick = { userInteracted = true; scrollScope.launch { listState.animateScrollToItem(0); newCount = 0 } },
                modifier = Modifier.fillMaxWidth()) {
                Text(if (newCount > 0) "새 메시지 ${newCount}개 · 최신으로" else "최신 메시지로")
            }
            LazyColumn(Modifier.weight(1f).fillMaxWidth(), state = listState, reverseLayout = true, contentPadding = PaddingValues(horizontal = 16.dp, vertical = 12.dp),
                verticalArrangement = Arrangement.spacedBy(10.dp)) {
                items(visiblePending.asReversed(), key = { "pending-${it.command.clientMessageId.value}" }) { record ->
                    Column(Modifier.fillMaxWidth(), horizontalAlignment = Alignment.End) {
                        Surface(shape = RoundedCornerShape(16.dp), color = MaterialTheme.colorScheme.surfaceVariant) {
                            Text(if (record.phase == OutboxPhase.COMMITTED) "메시지를 볼 수 없어요." else
                                record.command.media?.let { if (it is MediaContent.Sticker) "스티커" else "첨부 파일" } ?: record.command.text,
                                Modifier.padding(12.dp), style = MaterialTheme.typography.bodyLarge)
                        }
                        Text(when (record.phase) {
                            OutboxPhase.PREPARED, OutboxPhase.SENDING -> if (state.sending) "보내는 중" else "전송이 지연되고 있어요"
                            OutboxPhase.COMMITTED -> "보냄"
                            OutboxPhase.REJECTED -> "보내지 못했어요"
                            OutboxPhase.PARKED -> "보내지 않은 메시지"
                            else -> "전송이 지연되고 있어요"
                        }, style = MaterialTheme.typography.labelSmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
                        if (record.phase in setOf(OutboxPhase.UNKNOWN, OutboxPhase.COMMITTED, OutboxPhase.SENDING, OutboxPhase.PREPARED))
                            TextButton(onClick = model::reconcile, enabled = !state.sending) { Text("다시 확인") }
                    }
                }
                val messages = data.messages.asReversed()
                itemsIndexed(messages, key = { _, message -> message.id.value }) { index, message ->
                    val older = messages.getOrNull(index + 1)
                    val newer = messages.getOrNull(index - 1)
                    val startsGroup = older == null || older.author != message.author || older.audience != message.audience ||
                        java.time.Duration.between(older.createdAt, message.createdAt).toMinutes() >= 5
                    val endsGroup = newer == null || newer.author != message.author || newer.audience != message.audience ||
                        java.time.Duration.between(message.createdAt, newer.createdAt).toMinutes() >= 5
                    if (message.id.value == state.firstUnreadMessageId) Text("여기부터 읽지 않은 메시지",
                        Modifier.fillMaxWidth().padding(vertical = 8.dp), style = MaterialTheme.typography.labelMedium,
                        color = MaterialTheme.colorScheme.primary)
                    MessageBubble(message, (message.author as? MessageAuthor.Member)?.actorId == model.selection.membership.actorId, media?.client,
                        canReply = model.selection.membership.role == RoomRole.STREAMER, onReply = { model.reply(message, data.scope) },
                        onActions = { showActions = true; model.showActions(message, data.scope) },
                        onReaction = { emoji -> model.react(message, data.scope, emoji) },
                        onQuoteNavigate = { userInteracted = true; attemptedQuoteCursor = null; quoteTarget = it; quoteNotice = null },
                        onOpenMedia = { openedMedia = it },
                        profile = data.profiles.find { it.actorId == (message.author as? MessageAuthor.Member)?.actorId },
                        reactions = state.reactions[message.id] ?: message.reactions, showAuthor = startsGroup, showTime = endsGroup)
                }
                if (data.historyCursor != null) item { TextButton(onClick = { userInteracted = true; model.history() }, modifier = Modifier.fillMaxWidth()) { Text("이전 메시지 보기") } }
                if (data.messages.isEmpty() && visiblePending.isEmpty()) item {
                    Text("아직 표시할 메시지가 없어요.", Modifier.fillMaxWidth().padding(vertical = 24.dp), style = MaterialTheme.typography.bodyMedium,
                        color = MaterialTheme.colorScheme.onSurfaceVariant)
                }
            }
            HorizontalDivider()
            Column(Modifier.fillMaxWidth().padding(horizontal = 16.dp, vertical = 8.dp), verticalArrangement = Arrangement.spacedBy(6.dp)) {
                visibleQuote?.let { quote ->
                    Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically) {
                        Text("답장: ${quote.textSummary()}", Modifier.weight(1f), maxLines = 2, style = MaterialTheme.typography.bodySmall)
                        TextButton(onClick = model::clearReply, enabled = !draft.submitting) { Text("취소") }
                    }
                }
                if (media != null) {
                    if (draft.media != null) Row(verticalAlignment = Alignment.CenterVertically) {
                        Text(if (draft.media is MediaContent.Sticker) "스티커 선택됨" else "첨부 파일 준비됨", Modifier.weight(1f))
                        TextButton(onClick = model::clearMedia, enabled = !draft.submitting && !draft.uploading) { Text("첨부 취소") }
                    }
                    if (draft.uploading) LinearProgressIndicator(Modifier.fillMaxWidth())
                    FlowRow(horizontalArrangement = Arrangement.spacedBy(4.dp)) {
                        val enabled = !draft.submitting && !draft.uploading && draft.media == null
                        MediaPicker(MediaKind.PHOTO, enabled, media.client.scope, { model.upload(data.scope, it) }, { model.mediaFailure() })
                        MediaPicker(MediaKind.VIDEO, enabled, media.client.scope, { model.upload(data.scope, it) }, { model.mediaFailure() })
                        TextButton(onClick = { stickers = true }, enabled = enabled) { Text("스티커") }
                    }
                    data.pendingMedia.forEach { pending ->
                        TextButton(onClick = { model.recoverMedia(data.scope, pending) }, enabled = !draft.uploading && !draft.submitting) {
                            Text("${if (pending.kind == MediaKind.VIDEO) "동영상" else "사진"} 계속 첨부")
                        }
                    }
                }
                OutlinedTextField(value = draft.text, onValueChange = model::text, modifier = Modifier.fillMaxWidth(), maxLines = 5,
                    enabled = !draft.submitting && !draft.uploading && draft.media !is MediaContent.Sticker, placeholder = { Text(if (visibleQuote != null) "답장" else "메시지") },
                    supportingText = { Text(draft.error ?: if (draft.text.codePointCount(0, draft.text.length) >= 3800) "${4000 - draft.text.codePointCount(0, draft.text.length)}자 남음" else "") }, isError = draft.error != null)
                Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.End) {
                    Button(onClick = { model.send(data.scope) }, enabled = !state.sending && !draft.submitting && !draft.uploading &&
                        (draft.media != null || runCatching { TextCommand.normalizeText(draft.text) }.isSuccess) &&
                        (draft.quote == null || visibleQuote != null)) { Text("보내기") }
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
private data class OpenedMessageMedia(val messageId: String, val assetId: String, val variant: MediaVariant)

@OptIn(ExperimentalLayoutApi::class)
@Composable
private fun MessageBubble(message: ConversationMessage, own: Boolean, media: MediaClient?, canReply: Boolean, onReply: () -> Unit,
                          onActions: () -> Unit, onReaction: (String) -> Unit, onQuoteNavigate: (String) -> Unit,
                          onOpenMedia: (OpenedMessageMedia) -> Unit, profile: ConversationProfile?, reactions: MessageReactions,
                          showAuthor: Boolean, showTime: Boolean) {
    Column(Modifier.fillMaxWidth(), horizontalAlignment = if (own) Alignment.End else Alignment.Start) {
        val author = when (val author = message.author) { MessageAuthor.Anonymous -> "익명"; is MessageAuthor.Member -> author.nickname }
        if (showAuthor && !own) {
            val shape = Modifier.size(40.dp).clip(androidx.compose.foundation.shape.CircleShape)
            if (media != null && profile?.avatar != null && message.author is MessageAuthor.Member) chat.rogi.rogichat.feature.media.AuthorizedMedia(media, profile.avatar.value,
                MediaAccess.Avatar(requireNotNull(media.scope.roomId), profile.actorId.value), shape, avatar = true)
            else if (media != null && profile?.providerAvatarAvailable == true) chat.rogi.rogichat.feature.media.AuthorizedProviderAvatar(media, modifier = shape, actorId = profile.actorId.value)
            else AvatarPlaceholder(shape)
        }
        if (showAuthor && !own) Text(author, style = MaterialTheme.typography.labelMedium,
            color = MaterialTheme.colorScheme.onSurfaceVariant)
        Surface(shape = RoundedCornerShape(16.dp), color = if (own) MaterialTheme.colorScheme.primaryContainer else MaterialTheme.colorScheme.surfaceVariant) {
            Column(Modifier.padding(12.dp)) {
                message.quote?.let { quote ->
                    TextButton(onClick = { onQuoteNavigate(quote.id.value) }, contentPadding = PaddingValues(0.dp)) {
                        Column(horizontalAlignment = Alignment.Start) {
                            Text(quote.authorName, style = MaterialTheme.typography.labelSmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
                            Text(quote.text, style = MaterialTheme.typography.bodySmall,
                                color = MaterialTheme.colorScheme.onSurfaceVariant, maxLines = 2)
                        }
                    }
                    HorizontalDivider(Modifier.padding(vertical = 6.dp))
                }
                when (val content = message.content) {
                    is MessageContent.Text -> Text(message.textSummary(), style = MaterialTheme.typography.bodyLarge)
                    is MessageContent.Media -> {
                        if (media != null) content.attachments.forEach { attachment ->
                            val variant = if (content.type == "VIDEO") MediaVariant.video else MediaVariant.image
                            if (content.type == "VIDEO") VideoMessage(media, attachment.assetId.value,
                                requireNotNull(media.scope.roomId), message.id.value)
                            else AuthorizedMedia(media, attachment.assetId.value,
                                MediaAccess.Message(requireNotNull(media.scope.roomId), message.id.value, MediaVariant.image),
                                Modifier.widthIn(max = 320.dp).heightIn(max = 360.dp))
                            TextButton(onClick = { onOpenMedia(OpenedMessageMedia(message.id.value, attachment.assetId.value, variant)) }) {
                                Text(if (variant == MediaVariant.video) "동영상 크게 보기" else "사진 크게 보기")
                            }
                        } else Text(message.textSummary())
                        content.caption?.let { Text(it, style = MaterialTheme.typography.bodyLarge) }
                    }
                    is MessageContent.Sticker -> if (media != null) AuthorizedMedia(media, content.assetId.value,
                        MediaAccess.Sticker(requireNotNull(media.scope.roomId), content.stickerId.value, message.id.value), Modifier.size(120.dp))
                        else Text("스티커")
                }
            }
        }
        FlowRow(horizontalArrangement = Arrangement.spacedBy(4.dp), verticalArrangement = Arrangement.spacedBy(4.dp)) {
            reactions.counts.filter { it.count > 0 }.forEach { reaction ->
                Surface(onClick = { onReaction(reaction.emoji) }, shape = RoundedCornerShape(14.dp),
                    color = if (reactions.mine == reaction.emoji) MaterialTheme.colorScheme.primaryContainer else MaterialTheme.colorScheme.surfaceVariant) {
                    Text("${reaction.emoji} ${reaction.count}", Modifier.padding(horizontal = 9.dp, vertical = 5.dp), style = MaterialTheme.typography.labelMedium)
                }
            }
            Surface(onClick = onActions, shape = RoundedCornerShape(14.dp), color = MaterialTheme.colorScheme.surfaceVariant) {
                Box(Modifier.padding(horizontal = 9.dp, vertical = 5.dp)) {
                    Icon(PhosphorIcons.Regular.Smiley, contentDescription = "반응 추가", modifier = Modifier.size(17.dp))
                    Icon(PhosphorIcons.Regular.Plus, contentDescription = null,
                        modifier = Modifier.align(Alignment.TopEnd).offset(x = 5.dp, y = (-3).dp).size(9.dp))
                }
            }
        }
        FlowRow(horizontalArrangement = Arrangement.spacedBy(4.dp)) {
            if (showTime) Text(DateTimeFormatter.ofPattern("HH:mm").withZone(ZoneId.systemDefault()).format(message.createdAt), style = MaterialTheme.typography.labelSmall,
                color = MaterialTheme.colorScheme.onSurfaceVariant)
            if (canReply && !own && message.replyTarget != null) TextButton(onClick = onReply) { Text("답장") }
            TextButton(onClick = onActions, modifier = Modifier.semantics { contentDescription = "메시지 작업" }) { Text("⋯") }
        }
    }
}

@OptIn(ExperimentalMaterial3Api::class)
@Composable
private fun VideoMessage(client: MediaClient, assetId: String, roomId: String, messageId: String) {
    var playing by remember(client.scope.presentationID, assetId, messageId) { mutableStateOf(false) }
    Box(Modifier.width(260.dp).height(220.dp).clickable { playing = true }, contentAlignment = Alignment.Center) {
        AuthorizedMedia(client, assetId, MediaAccess.Message(roomId, messageId, MediaVariant.poster), Modifier.fillMaxSize())
        Text("▶", style = MaterialTheme.typography.displayMedium, color = androidx.compose.ui.graphics.Color.White,
            modifier = Modifier.semantics { contentDescription = "동영상 재생" })
    }
    if (playing) ModalBottomSheet(onDismissRequest = { playing = false }) {
        AuthorizedMedia(client, assetId, MediaAccess.Message(roomId, messageId, MediaVariant.video), Modifier.fillMaxWidth().height(320.dp))
    }
}
