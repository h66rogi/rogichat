package chat.rogi.rogichat.feature.settings

import androidx.compose.foundation.layout.*
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import chat.rogi.rogichat.core.design.*

@Composable
fun ProfileScreen(editor: ProfileEditor, onEdit: (String) -> Unit, onDiscard: () -> Unit, onRetry: () -> Unit) {
    var confirmingDiscard by remember { mutableStateOf(false) }
    when (editor.phase) {
        ProfilePhase.LOADING -> ScreenStatus("프로필을 불러오는 중", "잠시만 기다려 주세요.", loading = true)
        ProfilePhase.FAILED -> ScreenStatus("프로필을 불러오지 못했어요", "다시 시도해 주세요.", onRetry = onRetry)
        ProfilePhase.UNAVAILABLE -> ScreenStatus("프로필 연결 준비 중", "계정 정보 연결 후 편집할 수 있어요.")
        ProfilePhase.READY -> {
            SettingsSection("표시 이름") {
                Column(Modifier.fillMaxWidth().padding(16.dp), verticalArrangement = Arrangement.spacedBy(12.dp)) {
                    OutlinedTextField(editor.draft, onEdit, label = { Text("표시 이름") }, singleLine = true,
                        isError = editor.error != null, supportingText = { Text(editor.error ?: "${editor.length}/40") },
                        modifier = Modifier.fillMaxWidth())
                    Text("변경한 이름은 아직 저장되지 않아요. 이 실행에서만 입력이 유지돼요.")
                    AppButton(onClick = {}, enabled = false) { Text("저장 · 준비 중") }
                    OutlinedButton(onClick = { confirmingDiscard = true }, enabled = editor.changed) { Text("입력 되돌리기") }
                }
            }
            SettingsSection("선택 정보") {
                SettingsRow("프로필 사진", "사진 설정 준비 중", enabled = false)
                SettingsRow("생일과 공개 범위", "선택 정보 설정 준비 중 · 생일을 입력받지 않아요", enabled = false)
            }
        }
    }
    if (confirmingDiscard) ConfirmationPrompt("입력을 되돌릴까요?", "이름 입력을 처음 값으로 되돌려요.", "되돌리기",
        onDismiss = { confirmingDiscard = false }, onConfirm = { confirmingDiscard = false; onDiscard() })
}
