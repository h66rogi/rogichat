package chat.rogi.rogichat.feature.settings

import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import chat.rogi.rogichat.BuildConfig
import chat.rogi.rogichat.core.design.SettingsRow
import chat.rogi.rogichat.core.design.SettingsSection
import chat.rogi.rogichat.core.navigation.*

@Composable
fun SettingsScreen(access: ShellAccess, onOpen: (AppPage) -> Unit) {
    SettingsSection("내 계정") {
        if (access == ShellAccess.READY) SettingsRow("내 프로필", "표시 이름과 선택 정보") { onOpen(AppPage.PROFILE) }
        if (access == ShellAccess.READY || access == ShellAccess.LINK_REQUIRED) {
            SettingsRow("계정 관리", "연결 상태 · 로그아웃 · 회원 탈퇴") { onOpen(AppPage.ACCOUNT) }
        } else SettingsRow("계정 기능", "로그인 및 이용 상태 확인 후 사용할 수 있어요", enabled = false)
    }
    SettingsSection("앱 설정") {
        SettingsRow("알림", "기기 권한과 서비스 연결 상태") { onOpen(AppPage.NOTIFICATIONS) }
        SettingsRow("앱 정보 및 지원", "버전 · 이용약관 · 개인정보 처리방침") { onOpen(AppPage.ABOUT) }
    }
    Text("서비스에 연결되지 않은 설정은 변경하거나 저장하지 않아요.")
}

@Composable
fun AboutScreen() {
    SettingsSection("로기챗") {
        SettingsRow("앱 버전", "${BuildConfig.VERSION_NAME} (${BuildConfig.VERSION_CODE}) · ${BuildConfig.ENVIRONMENT}")
    }
    SettingsSection("정책 및 지원") {
        SettingsRow("이용약관", "공개 주소 준비 중", enabled = false)
        SettingsRow("개인정보 처리방침", "공개 주소 준비 중", enabled = false)
        SettingsRow("문의하기", "지원 경로 준비 중", enabled = false)
    }
}
