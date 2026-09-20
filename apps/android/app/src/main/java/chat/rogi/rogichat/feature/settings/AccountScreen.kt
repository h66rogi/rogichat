package chat.rogi.rogichat.feature.settings

import androidx.compose.foundation.layout.*
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import chat.rogi.rogichat.core.design.*
import chat.rogi.rogichat.core.session.AccountSummary
import chat.rogi.rogichat.core.deletion.DeletionIntent
import java.util.UUID
import com.adamglin.PhosphorIcons
import com.adamglin.phosphoricons.Regular
import com.adamglin.phosphoricons.regular.SignOut

// MoreScreen's destructive confirmation and error-safe logout flow adapted to injected account actions.
@Composable
fun AccountScreen(account: AccountSummary, busy: Boolean, onSignOut: (() -> Unit)?,
                  onCloseAccount: ((DeletionIntent) -> Unit)?, onLink: (() -> Unit)?, scopeEpoch: Long) {
    var deletionConfirmation by remember { mutableStateOf<Pair<DeletionIntent, String>?>(null) }
    var confirmSignOut by remember { mutableStateOf<(() -> Unit)?>(null) }
    SettingsSection("계정 연결") {
        account.signInMethod?.let { SettingsRow("로그인 방식", it) }
        SettingsRow("SOOP 계정", if (account.soopConnected) "연결됨" else "연결 필요", onClick = onLink)
    }
    if (onSignOut != null || onCloseAccount != null) SettingsSection("계정 관리") {
        if (busy) CircularProgressIndicator(Modifier.padding(20.dp).size(24.dp))
        else {
            if (onSignOut != null) SettingsRow("로그아웃", icon = PhosphorIcons.Regular.SignOut) { confirmSignOut = onSignOut }
            if (onCloseAccount != null) SettingsRow("회원 탈퇴", titleColor = MaterialTheme.colorScheme.error) {
                deletionConfirmation = DeletionIntent(account.id, scopeEpoch, UUID.randomUUID().toString()) to account.nickname
            }
        }
    }
    deletionConfirmation?.let { (intent, nickname) ->
        ConfirmationPrompt("로기챗을 탈퇴할까요?", "$nickname 계정의 탈퇴를 요청해요. 접수되면 이 계정으로 대화를 이용할 수 없어요.", "탈퇴 요청",
            onDismiss = { deletionConfirmation = null }, onConfirm = { deletionConfirmation = null; onCloseAccount?.invoke(intent) }, enabled = !busy)
    }
    confirmSignOut?.let { originalSignOut ->
        ConfirmationPrompt("로그아웃할까요?", "이 기기에서 로기챗 계정이 로그아웃돼요.", "로그아웃",
            onDismiss = { confirmSignOut = null }, onConfirm = { confirmSignOut = null; originalSignOut() }, enabled = !busy)
    }
}
