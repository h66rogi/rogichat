package chat.rogi.rogichat.feature.messageactions

import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.*
import chat.rogi.rogichat.core.messageactions.*

/** Parent owns scope, journal, transport and reload. Callbacks always carry original view token. */
@Composable
fun MessageActionsPanel(token: ActionViewToken, record: ActionRecord?, busy: Boolean,
    reactions: MessageReactions?, unavailableActions: Set<MessageAction>, onAction: (ActionViewToken, MessageAction, String?) -> Unit,
    onRefresh: (ActionViewToken) -> Unit) {
    var confirmation by remember(token) { mutableStateOf<MessageAction?>(null) }
    val selected = token.selection
    fun blocked(action: MessageAction) = busy || action in unavailableActions
    Column {
        if (busy) CircularProgressIndicator()
        record?.takeIf { it.phase in setOf(ActionPhase.REPORTED, ActionPhase.REJECTED, ActionPhase.BLOCKED) }?.let { Text(actionStatus(it.phase)) }
        reactions?.let { summary ->
            Row { summary.counts.forEach { Text("${it.emoji} ${it.count}  ") } }
        }
        if (record?.phase != ActionPhase.BLOCKED) {
            Row {
                if (selected.hints.delete && !selected.anonymous) TextButton(enabled = !blocked(MessageAction.DELETE),
                    onClick = { confirmation = MessageAction.DELETE }) { Text("삭제") }
                if (selected.hints.publish && !selected.anonymous && selected.contentKind in setOf("TEXT", "PHOTO"))
                    TextButton(enabled = !blocked(MessageAction.PUBLISH), onClick = { confirmation = MessageAction.PUBLISH }) { Text("익명으로 공개") }
            }
            Row {
                reactionChoices.forEach { emoji ->
                    val selected = reactions?.mine == emoji
                    val command = if (selected) MessageAction.REMOVE_REACTION else MessageAction.SET_REACTION
                    TextButton(enabled = !blocked(command),
                        onClick = { onAction(token, command, if (selected) null else emoji) },
                        colors = if (selected) ButtonDefaults.textButtonColors(containerColor = MaterialTheme.colorScheme.primaryContainer)
                            else ButtonDefaults.textButtonColors()) { Text(emoji) }
                }
            }
        }
    }
    // Adapted from Meloming non-chat MyReviewsScreen's captured deleteTarget AlertDialog.
    confirmation?.let { target ->
        val deleting = target == MessageAction.DELETE
        AlertDialog(onDismissRequest = { confirmation = null },
            title = { Text(if (deleting) "메시지 삭제" else "메시지 공개") },
            text = { Text(if (deleting) "삭제하면 이 메시지를 볼 수 있던 모든 사람의 대화에서 사라져요. 연결된 익명 공개본도 함께 사라지며, 이미 저장한 사본은 지울 수 없어요."
                else "작성자를 익명으로 표시해 방 전체에 공개할까요?") },
            confirmButton = { TextButton(enabled = !blocked(target), onClick = {
                confirmation = null; onAction(token, target, null)
            }) { Text(if (deleting) "삭제" else "공개", color = if (deleting) MaterialTheme.colorScheme.error else MaterialTheme.colorScheme.primary) } },
            dismissButton = { TextButton(onClick = { confirmation = null }) { Text("취소") } })
    }
}
fun actionStatus(phase: ActionPhase) = when (phase) {
    ActionPhase.REPORTED -> "신고가 접수되었어요."
    ActionPhase.ACTOR_BLOCKED -> "작성자를 차단했어요."
    ActionPhase.UNKNOWN -> "잠시 후 다시 확인해 주세요."
    ActionPhase.BLOCKED -> "메시지 접근이 차단되었어요."
    ActionPhase.PREPARING -> "공개하는 중이에요."
    ActionPhase.PUBLISHED -> "메시지가 익명으로 공개되었어요."
    ActionPhase.REVOKED -> "공개본 접근이 회수되었어요."
    ActionPhase.REACTED -> "반응이 반영되었어요."
    ActionPhase.REJECTED -> "처리하지 못했어요. 메시지를 다시 확인하고 시도해 주세요."
}

/** Optional detail is intentionally omitted. Anonymous messages can be reported without exposing an actor. */
@Composable
fun MessageModerationPanel(token: ActionViewToken, busy: Boolean, unavailableActions: Set<MessageAction>, preview: String,
    onAction: (ActionViewToken, MessageAction, ReportReason?) -> Unit) {
    var reporting by remember(token) { mutableStateOf(false) }
    var blocking by remember(token) { mutableStateOf(false) }
    Column {
        TextButton(enabled = !busy && MessageAction.REPORT !in unavailableActions, onClick = { reporting = true }) { Text("신고") }
        val actor = token.selection.visibleActorId
        if (!token.selection.anonymous && actor != null && actor != token.selection.scope.actorId)
            TextButton(enabled = !busy && MessageAction.BLOCK_ACTOR !in unavailableActions, onClick = { blocking = true }) { Text("작성자 차단") }
    }
    if (reporting) AlertDialog(onDismissRequest = { reporting = false }, title = { Text("이 메시지를 신고할까요?") },
        text = { Column { Text(preview.take(200)); Text("신고 사유와 이 메시지의 위치가 전달돼요. 주변 대화와 메시지 본문은 자동으로 보내지지 않아요."); ReportReason.entries.forEach { reason ->
            TextButton(enabled = !busy && MessageAction.REPORT !in unavailableActions, onClick = { reporting = false; onAction(token, MessageAction.REPORT, reason) }) { Text(reason.label) }
        } } }, confirmButton = {}, dismissButton = { TextButton(onClick = { reporting = false }) { Text("취소") } })
    if (blocking) AlertDialog(onDismissRequest = { blocking = false }, title = { Text("작성자 차단") },
        text = { Text("이 방에서 작성자를 차단할까요? 메시지 표시와 직접 전송이 제한돼요.") },
        confirmButton = { TextButton(enabled = !busy && MessageAction.BLOCK_ACTOR !in unavailableActions, onClick = { blocking = false; onAction(token, MessageAction.BLOCK_ACTOR, null) }) { Text("차단") } },
        dismissButton = { TextButton(onClick = { blocking = false }) { Text("취소") } })
}
