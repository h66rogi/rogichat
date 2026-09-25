package chat.rogi.rogichat.feature.auth

import androidx.compose.foundation.layout.*
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import chat.rogi.rogichat.core.auth.*

@Composable
fun AuthStatusBanner(state: AuthUiState, onCancel: () -> Unit, onReauthenticate: (() -> Unit)?) {
    Surface(color = MaterialTheme.colorScheme.surfaceVariant) {
        val provider = if (state.provider == AuthProvider.APPLE) "Apple" else "SOOP"
        Column(Modifier.fillMaxWidth().padding(horizontal = 20.dp, vertical = 12.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
            Text(state.error?.message ?: when (state.phase) {
                AuthPhase.STARTING -> "$provider 로그인을 시작하고 있어요."
                AuthPhase.AWAITING_BROWSER -> "브라우저에서 $provider 로그인을 진행해 주세요."
                AuthPhase.EXCHANGING -> "$provider 인증 결과를 확인하고 있어요."
                AuthPhase.IDLE -> ""
            }, style = MaterialTheme.typography.bodyMedium)
            Column(verticalArrangement = Arrangement.spacedBy(4.dp)) {
                TextButton(onClick = onCancel) { Text(if (state.error == AuthProblem.CANCEL_UNCONFIRMED) "취소 다시 시도" else if (state.active) "로그인 취소" else "닫기") }
                if (onReauthenticate != null) TextButton(onClick = onReauthenticate) { Text("로그아웃 후 다시 로그인") }
            }
        }
    }
}
