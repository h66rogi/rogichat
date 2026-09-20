package chat.rogi.rogichat.feature.settings

import androidx.compose.material3.*
import androidx.compose.runtime.*
import chat.rogi.rogichat.core.design.*

enum class AccountNotice { LOGOUT, DELETION, END_PREVIEW }
data class AccountPresentation(val signInSummary: String, val connectionSummary: String)

@Composable
fun AccountScreen(account: AccountPresentation, onEndPreview: (() -> Unit)? = null) {
    var notice by remember { mutableStateOf<AccountNotice?>(null) }
    SettingsSection("계정 연결") {
        SettingsRow("로그인 계정", account.signInSummary)
        SettingsRow("SOOP 연결", account.connectionSummary)
        SettingsRow("계정 연결 변경", "계정 연결 기능 준비 중", enabled = false)
    }
    SettingsSection("계정 관리") {
        SettingsRow("로그아웃", "로그아웃 안내 보기") { notice = AccountNotice.LOGOUT }
        SettingsRow("회원 탈퇴", "회원 탈퇴 안내 보기") { notice = AccountNotice.DELETION }
    }
    if (onEndPreview != null) OutlinedButton(onClick = { notice = AccountNotice.END_PREVIEW }) { Text("미리보기 종료") }
    when (notice) {
        AccountNotice.LOGOUT -> ConfirmationPrompt("로그아웃", "로그아웃 기능은 준비 중이에요. 현재 계정은 변경되지 않아요.",
            "로그아웃 · 준비 중", { notice = null }, {}, enabled = false)
        AccountNotice.DELETION -> ConfirmationPrompt("회원 탈퇴", "탈퇴 기능과 데이터 처리 안내를 준비하고 있어요. 현재 계정이나 데이터는 삭제되지 않아요.",
            "탈퇴 · 준비 중", { notice = null }, {}, enabled = false)
        AccountNotice.END_PREVIEW -> ConfirmationPrompt("미리보기를 종료할까요?", "프로필 입력과 대화 초안이 초기화돼요. 실제 계정에는 영향을 주지 않아요.",
            "종료", { notice = null }, { notice = null; onEndPreview?.invoke() })
        null -> Unit
    }
}
