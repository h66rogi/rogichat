package chat.rogi.rogichat.feature.settings

import androidx.compose.foundation.layout.*
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import chat.rogi.rogichat.core.design.*
import chat.rogi.rogichat.core.session.AccountSummary
import com.adamglin.PhosphorIcons
import com.adamglin.phosphoricons.Regular
import com.adamglin.phosphoricons.regular.SignOut

enum class AccountAction { SIGN_OUT, CLOSE_ACCOUNT }

// MoreScreen's destructive confirmation and error-safe logout flow adapted to injected account actions.
@Composable
fun AccountScreen(account: AccountSummary, busy: Boolean, onSignOut: (() -> Unit)?,
                  onCloseAccount: (() -> Unit)?, onLink: (() -> Unit)?) {
    var confirmation by remember { mutableStateOf<AccountAction?>(null) }
    SettingsSection("계정 연결") {
        account.signInMethod?.let { SettingsRow("로그인 방식", it) }
        SettingsRow("SOOP 계정", if (account.soopConnected) "연결됨" else "연결 필요", onClick = onLink)
    }
    if (onSignOut != null || onCloseAccount != null) SettingsSection("계정 관리") {
        if (busy) CircularProgressIndicator(Modifier.padding(20.dp).size(24.dp))
        else {
            if (onSignOut != null) SettingsRow("로그아웃", icon = PhosphorIcons.Regular.SignOut) { confirmation = AccountAction.SIGN_OUT }
            if (onCloseAccount != null) SettingsRow("회원 탈퇴", titleColor = MaterialTheme.colorScheme.error) {
                confirmation = AccountAction.CLOSE_ACCOUNT
            }
        }
    }
    when (confirmation) {
        AccountAction.SIGN_OUT -> ConfirmationPrompt("로그아웃할까요?", "이 기기에서 로기챗 계정이 로그아웃돼요.", "로그아웃",
            onDismiss = { confirmation = null }, onConfirm = { confirmation = null; onSignOut?.invoke() }, enabled = !busy)
        AccountAction.CLOSE_ACCOUNT -> ConfirmationPrompt("로기챗을 탈퇴할까요?", "탈퇴하면 이 계정으로 대화를 이용할 수 없어요. 계속 진행할까요?", "회원 탈퇴",
            onDismiss = { confirmation = null }, onConfirm = { confirmation = null; onCloseAccount?.invoke() }, enabled = !busy)
        null -> Unit
    }
}
