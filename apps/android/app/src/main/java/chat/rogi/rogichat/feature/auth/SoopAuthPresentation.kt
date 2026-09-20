package chat.rogi.rogichat.feature.auth

import androidx.compose.foundation.layout.*
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.selection.toggleable
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.unit.dp
import chat.rogi.rogichat.core.auth.*

/** Reuses LoginScreen's explicit confirmation dialog and callback-driven browser launch pattern.
 * Consent wording/version is shared with the reviewed web AuthPanel; no consent is persisted by UI.
 */
@Composable
fun SoopConsentDialog(rulesUrl: String, busy: Boolean, onDismiss: () -> Unit, onConfirm: () -> Unit) {
    var consent by remember { mutableStateOf(false) }
    var browserError by remember { mutableStateOf(false) }
    val context = LocalContext.current
    AlertDialog(onDismissRequest = { if (!busy) onDismiss() }, title = { Text("SOOP으로 로그인") }, text = {
        Column(Modifier.verticalScroll(rememberScrollState()), verticalArrangement = Arrangement.spacedBy(12.dp)) {
            TextButton(onClick = { browserError = !ExternalBrowserHandler.openUrl(context, rulesUrl) }) { Text("이용 안내 읽기") }
            Row(
                modifier = Modifier.fillMaxWidth().toggleable(
                    value = consent, enabled = !busy, role = Role.Checkbox,
                    onValueChange = { consent = it },
                ),
                verticalAlignment = Alignment.Top,
            ) {
                Checkbox(checked = consent, onCheckedChange = null, enabled = !busy)
                Text(TERMS_CONSENT, Modifier.padding(top = 12.dp))
            }
            if (browserError) Text(AuthProblem.BROWSER.message, color = MaterialTheme.colorScheme.error)
        }
    }, confirmButton = { TextButton(onClick = onConfirm, enabled = consent && !busy) { Text("동의하고 계속") } },
        dismissButton = { TextButton(onClick = onDismiss, enabled = !busy) { Text("취소") } })
}

@Composable
fun AuthStatusBanner(state: AuthUiState, onCancel: () -> Unit, onReauthenticate: (() -> Unit)?) {
    Surface(color = MaterialTheme.colorScheme.surfaceVariant) {
        Column(Modifier.fillMaxWidth().padding(horizontal = 20.dp, vertical = 12.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
            Text(state.error?.message ?: when (state.phase) {
                AuthPhase.STARTING -> "SOOP 로그인을 시작하고 있어요."
                AuthPhase.AWAITING_BROWSER -> "브라우저에서 SOOP 로그인을 진행해 주세요."
                AuthPhase.EXCHANGING -> "SOOP 인증 결과를 확인하고 있어요."
                AuthPhase.IDLE -> ""
            }, style = MaterialTheme.typography.bodyMedium)
            Column(verticalArrangement = Arrangement.spacedBy(4.dp)) {
                TextButton(onClick = onCancel) { Text(if (state.error == AuthProblem.CANCEL_UNCONFIRMED) "취소 다시 시도" else if (state.active) "로그인 취소" else "닫기") }
                if (onReauthenticate != null) TextButton(onClick = onReauthenticate) { Text("로그아웃 후 다시 로그인") }
            }
        }
    }
}
