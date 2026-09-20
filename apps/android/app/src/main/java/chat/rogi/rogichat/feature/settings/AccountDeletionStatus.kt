package chat.rogi.rogichat.feature.settings

import androidx.compose.foundation.layout.*
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.*
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import chat.rogi.rogichat.core.deletion.*

/** Reuses the source-derived settings/status surface; outcome is always the coordinator's record. */
@Composable
fun AccountDeletionStatus(state: DeletionState, onRetryCleanup: () -> Unit, onReset: () -> Unit, onAcknowledge: () -> Unit,
                          onReauthenticate: (() -> Unit)?) {
    if (!state.visible) return
    val message = when {
        state.capacityReached -> "이 기기에 보관할 수 있는 탈퇴 요청 기록이 가득 찼어요. 새 요청은 보내지 않았어요."
        state.record == null -> "기기에 저장된 탈퇴 요청 기록을 확인하지 못했어요."
        state.busy -> "탈퇴 요청을 처리하고 있어요."
        else -> when (state.record.phase) {
            DeletionPhase.BLOCKED -> "탈퇴 요청이 접수됐어요. 계정 이용이 차단되며, 데이터 삭제 완료를 뜻하지는 않아요."
            DeletionPhase.REAUTH_DONE, DeletionPhase.REAUTH_RESTORING -> "탈퇴 요청을 보내려면 다시 로그인해야 해요. 로그인 후 계정을 확인하고 다시 선택해 주세요."
            DeletionPhase.ABORTED -> "탈퇴 요청을 보내지 않았어요. 다시 로그인한 뒤 요청할 수 있어요."
            DeletionPhase.PREPARING, DeletionPhase.CLEARED -> "탈퇴 요청을 보내기 위한 기기 정보 정리를 완료하지 못했어요."
            DeletionPhase.SENDING, DeletionPhase.UNKNOWN -> "탈퇴 요청의 접수 여부를 확인하지 못했어요. 서버에 접수되었을 수 있어요."
        }
    }
    Surface(color = MaterialTheme.colorScheme.surfaceVariant) {
        Column(Modifier.fillMaxWidth().heightIn(max = 240.dp).verticalScroll(rememberScrollState()).padding(horizontal = 20.dp, vertical = 12.dp)) {
            Text("이 기기의 탈퇴 요청 기록", style = MaterialTheme.typography.labelMedium)
            Text(message, style = MaterialTheme.typography.bodyMedium)
            state.record?.receipt?.let { Text("접수 번호: ${it.requestId}", style = MaterialTheme.typography.bodySmall) }
            if (state.storageFailure) Text("이 기기의 정보 정리가 필요해요. 다시 시도해도 탈퇴 요청을 다시 보내지 않아요.", style = MaterialTheme.typography.bodySmall)
            if (state.busy) LinearProgressIndicator(Modifier.fillMaxWidth().padding(top = 8.dp))
            else {
                if (state.storageFailure || state.record?.cleanupPending == true)
                    TextButton(onClick = onRetryCleanup) { Text("기기 정보 정리 다시 시도") }
                if (state.record?.phase == DeletionPhase.REAUTH_DONE && onReauthenticate != null)
                    TextButton(onClick = onReauthenticate) { Text("로그아웃 후 다시 로그인") }
                if (!state.blocksSession) TextButton(onClick = onAcknowledge) { Text("확인") }
                TextButton(onClick = onReset) { Text("이 기기의 계정 정보 초기화") }
            }
        }
    }
}
