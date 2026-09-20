package chat.rogi.rogichat.preview

import androidx.compose.foundation.layout.Box
import androidx.compose.material3.*
import androidx.compose.runtime.*
import chat.rogi.rogichat.feature.settings.*

private enum class NotificationExample(val label: String) {
    DEVICE("실제 기기"), UNKNOWN("미확인 예시"), READING("조회 중 예시"), DENIED("차단 예시"),
    ALLOWED("허용 예시"), NO_CHANNELS("채널 없음 예시"), BLOCKED_CHANNELS("채널 차단 예시"), FAILED("조회 오류 예시")
}

@Composable
fun NotificationPreview() {
    var example by remember { mutableStateOf(NotificationExample.DEVICE) }
    var expanded by remember { mutableStateOf(false) }
    Box {
        TextButton(onClick = { expanded = true }) { Text("알림 화면: ${example.label}") }
        DropdownMenu(expanded, onDismissRequest = { expanded = false }) {
            NotificationExample.entries.forEach { value ->
                DropdownMenuItem(text = { Text(value.label) }, onClick = { example = value; expanded = false })
            }
        }
    }
    key(example) {
        if (example == NotificationExample.DEVICE) NotificationSettingsScreen()
        else {
            Text("OS 상태 예시 · 실제 기기 설정과 달라요. 권한 요청이나 설정 변경은 실행하지 않아요.")
            val started = NotificationReadState().begin()
            val state = when (example) {
                NotificationExample.UNKNOWN -> NotificationReadState()
                NotificationExample.READING -> started
                NotificationExample.FAILED -> started.fail(started.revision)
                else -> started.finish(started.revision, NotificationSnapshot(
                    if (example == NotificationExample.DENIED) NotificationAuthorization.DENIED else NotificationAuthorization.ALLOWED,
                    blockedChannels = if (example == NotificationExample.BLOCKED_CHANNELS) 2 else 0,
                    hasChannels = example != NotificationExample.NO_CHANNELS))
            }
            NotificationSettingsContent(state)
        }
    }
}
