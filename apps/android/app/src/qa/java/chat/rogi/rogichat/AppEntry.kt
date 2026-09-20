package chat.rogi.rogichat

import androidx.compose.foundation.layout.*
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import chat.rogi.rogichat.core.design.*
import chat.rogi.rogichat.core.navigation.*
import chat.rogi.rogichat.feature.auth.WelcomeScreen
import chat.rogi.rogichat.feature.settings.*
import chat.rogi.rogichat.preview.*

@Composable
fun AppEntry() {
    // Deliberately memory-only. No synthetic access/role is restored as a real session.
    var state by remember { mutableStateOf(WireframeState()) }
    var accessMenu by remember { mutableStateOf(false) }
    AppShell(state.navigation, { state = state.selectTab(it) }, { state = state.back() }, banner = {
        Column(Modifier.fillMaxWidth().padding(horizontal = 20.dp, vertical = 8.dp)) {
            Text("QA · 화면 미리보기", style = MaterialTheme.typography.labelLarge)
            Text("샘플 데이터 · 실제 로그인 및 전송 안 됨", style = MaterialTheme.typography.bodySmall)
            Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                PreviewRole.entries.forEach { role ->
                    OutlinedButton(onClick = { state = state.switchRole(role) }, enabled = state.role != role) { Text(role.label) }
                }
                TextButton(onClick = { state = WireframeState(role = state.role) }) { Text("초기화") }
            }
            Box {
                TextButton(onClick = { accessMenu = true }) { Text("이용 상태 예시: ${state.navigation.access.label}") }
                DropdownMenu(expanded = accessMenu, onDismissRequest = { accessMenu = false }) {
                    ShellAccess.entries.forEach { access ->
                        DropdownMenuItem(text = { Text(access.label) }, onClick = {
                            state = state.switchAccess(access); accessMenu = false
                        })
                    }
                }
            }
        }
        HorizontalDivider()
    }) {
        when (state.page) {
            PreviewPage.WELCOME -> {
                WelcomeScreen()
                AppButton(onClick = { state = state.previewLink() }) { Text("연결 안내부터 미리보기") }
            }
            PreviewPage.LINK -> LinkWireframe(onPreview = { state = state.previewRooms() },
                onSinglePreview = { state = state.previewRooms(singleRoom = true) })
            PreviewPage.ROOMS -> RoomsWireframe(state, { state = state.copy(scenario = it) },
                { state = state.openRoom(it) }, { state = state.open(PreviewPage.SETTINGS) })
            PreviewPage.CHAT -> ChatWireframe(state, { state = state.changeAudience(it) },
                { state = state.selectTarget(it) }, { state = state.editDraft(it) }, { state = state.open(PreviewPage.REPORT) })
            PreviewPage.SETTINGS -> SettingsScreen(state.navigation.access) { state = state.open(it) }
            PreviewPage.PROFILE -> {
                FlowRow(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                    ProfilePhase.entries.forEach { phase ->
                        FilterChip(selected = state.profile.phase == phase, onClick = { state = state.profilePhase(phase) }, label = { Text(phase.label) })
                    }
                }
                ProfileScreen(state.profile, { state = state.editProfile(it) }, { state = state.discardProfile() },
                    { state = state.profilePhase(ProfilePhase.READY) })
            }
            PreviewPage.ACCOUNT -> AccountScreen(AccountPresentation("샘플 로그인 상태 · 실제 계정 미연동",
                if (state.navigation.access == ShellAccess.LINK_REQUIRED) "연결이 필요한 상태 예시" else "연결 이후 상태 예시 · 실제 연결 안 됨")) {
                    state = WireframeState(role = state.role)
                }
            PreviewPage.REPORT -> ReportWireframe()
            PreviewPage.NOTIFICATIONS -> NotificationPreview()
            PreviewPage.ABOUT -> AboutScreen()
            PreviewPage.STATUS -> ScreenStatus(state.navigation.access.label, "계정 이용 상태 안내 화면이에요. 설정에서 앱 정보와 지원을 확인할 수 있어요.")
        }
    }
}
