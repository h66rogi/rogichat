package chat.rogi.rogichat

import androidx.activity.compose.BackHandler
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.imePadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.Button
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.key
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import chat.rogi.rogichat.feature.auth.WelcomeScreen
import chat.rogi.rogichat.preview.*

@Composable
fun AppEntry() {
    // Deliberately memory-only: rotation/process restart exits the preview, never restores auth.
    var state by remember { mutableStateOf(WireframeState()) }
    BackHandler(state.page != PreviewPage.WELCOME) { state = state.back() }
    Scaffold { insets ->
        Column(Modifier.fillMaxSize().padding(insets).imePadding()) {
            Column(Modifier.fillMaxWidth().padding(horizontal = 20.dp, vertical = 8.dp)) {
                Text("QA · 화면 미리보기", style = MaterialTheme.typography.labelLarge)
                Text("샘플 데이터 · 실제 로그인 및 전송 안 됨", style = MaterialTheme.typography.bodySmall)
                Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                    PreviewRole.entries.forEach { role ->
                        OutlinedButton(onClick = { state = state.switchRole(role) }, enabled = state.role != role) { Text(role.label) }
                    }
                    TextButton(onClick = { state = WireframeState(role = state.role) }) { Text("초기화") }
                }
            }
            HorizontalDivider()
            key(state.page, state.roomId) {
                Column(Modifier.weight(1f).verticalScroll(rememberScrollState()).padding(20.dp),
                    verticalArrangement = Arrangement.spacedBy(16.dp)) {
                    if (state.page != PreviewPage.WELCOME) TextButton(onClick = { state = state.back() }) { Text("‹ 뒤로") }
                    Text(state.page.title, style = MaterialTheme.typography.headlineMedium)
                    when (state.page) {
                        PreviewPage.WELCOME -> {
                            WelcomeScreen()
                            Button(onClick = { state = state.previewLink() }) { Text("연결 안내부터 미리보기") }
                        }
                        PreviewPage.LINK -> LinkWireframe { state = state.previewRooms() }
                        PreviewPage.ROOMS -> RoomsWireframe(state, { state = state.copy(scenario = it) },
                            { state = state.openRoom(it) }, { state = state.open(PreviewPage.SETTINGS) })
                        PreviewPage.CHAT -> ChatWireframe(state, { state = state.changeAudience(it) },
                            { state = state.selectTarget(it) }, { state = state.editDraft(it) }, { state = state.open(PreviewPage.REPORT) })
                        PreviewPage.SETTINGS -> SettingsWireframe { state = state.open(it) }
                        PreviewPage.PROFILE -> ProfileWireframe()
                        PreviewPage.ACCOUNT -> AccountWireframe { state = WireframeState(role = state.role) }
                        PreviewPage.REPORT -> ReportWireframe()
                    }
                }
            }
        }
    }
}
