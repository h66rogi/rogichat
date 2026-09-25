package chat.rogi.rogichat.feature.messageactions

import androidx.compose.foundation.layout.Column
import androidx.compose.material3.*
import androidx.compose.runtime.*
import chat.rogi.rogichat.core.messageactions.*

@Composable
fun ActorBlocksPanel(token: BlockViewToken, blocks: List<BlockedActor>, complete: Boolean, busy: Boolean,
    failed: Boolean, unknownActors: Set<String>, lastOutcome: UnblockOutcome?, onRefresh: () -> Unit, onMore: () -> Unit,
    onUnblock: (BlockViewToken, String) -> Unit) {
    var selected by remember(token) { mutableStateOf<String?>(null) }
    Column {
        Text("이 방의 차단 관리")
        if (busy) CircularProgressIndicator()
        if (!busy && lastOutcome == UnblockOutcome.REJECTED) Text("차단을 해제하지 못했어요.")
        if (!busy && lastOutcome == UnblockOutcome.ACKNOWLEDGED) Text("차단 해제가 반영되었어요.")
        if (failed) Text("차단 목록을 불러오지 못했어요. 다시 확인해 주세요.")
        if (complete && blocks.isEmpty()) Text("차단한 사용자가 없어요.")
        blocks.forEach { actor ->
            Text("${actor.displayLabel} · ${actor.blockedAt.take(10)}")
            TextButton(enabled = complete && !busy, onClick = { selected = actor.actorId }) { Text("차단 해제") }
        }
        if (!complete && blocks.isNotEmpty()) TextButton(enabled = !busy, onClick = onMore) { Text("더 보기") }
        TextButton(enabled = !busy, onClick = onRefresh) { Text("새로고침") }
    }
    selected?.let { actor -> AlertDialog(onDismissRequest = { selected = null }, title = { Text("차단 해제") },
        text = { Text("이 방에서 차단을 해제할까요? 이전 참여 권한은 복구되지 않아요.") },
        confirmButton = { TextButton(enabled = complete && !busy, onClick = { selected = null; onUnblock(token, actor) }) { Text("해제") } },
        dismissButton = { TextButton(onClick = { selected = null }) { Text("취소") } }) }
}
