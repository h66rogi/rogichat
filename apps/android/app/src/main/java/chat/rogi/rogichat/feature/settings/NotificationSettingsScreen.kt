package chat.rogi.rogichat.feature.settings

import android.content.ActivityNotFoundException
import androidx.compose.material3.Text
import androidx.compose.runtime.*
import androidx.compose.ui.platform.LocalContext
import chat.rogi.rogichat.core.design.*

@Composable
fun NotificationSettingsScreen() {
    val context = LocalContext.current
    val system = remember(context) { NotificationSystem(context) }
    val epoch = LocalForegroundEpoch.current
    var state by remember { mutableStateOf(NotificationReadState()) }
    var openFailure by remember { mutableStateOf<String?>(null) }
    val refresh = {
        state = state.begin()
        val ticket = state.revision
        try { state = state.finish(ticket, system.read()) }
        catch (_: SecurityException) { state = state.fail(ticket) }
    }
    LaunchedEffect(epoch) { if (state.observing) refresh() }
    DisposableEffect(Unit) { onDispose { state = state.cancel() } }
    NotificationSettingsContent(state, openFailure, onRead = refresh, onOpen = {
        refresh()
        try { system.openSettings(); openFailure = null }
        catch (_: ActivityNotFoundException) { openFailure = "시스템 설정을 열지 못했어요. 기기 설정에서 로기챗을 찾아주세요." }
        catch (_: SecurityException) { openFailure = "기기에서 설정 화면 접근을 허용하지 않았어요." }
    })
}

@Composable
fun NotificationSettingsContent(state: NotificationReadState, openFailure: String? = null,
                                onRead: (() -> Unit)? = null, onOpen: (() -> Unit)? = null) {
    val status = when {
        state.reading -> "알림 상태를 확인하는 중이에요"
        state.failed -> "기기 알림 상태를 확인하지 못했어요. 다시 확인해 주세요."
        else -> state.snapshot?.description ?: "아직 확인하지 않았어요"
    }
    SettingsSection("이 기기의 OS 설정") {
        SettingsRow("알림 권한 확인", status, enabled = onRead != null && !state.reading, onClick = onRead)
        SettingsRow("시스템 알림 설정 열기", "기기 설정을 직접 확인해요", enabled = onOpen != null, onClick = onOpen)
    }
    if (openFailure != null) Text(openFailure)
    SettingsSection("서비스 연결") {
        SettingsRow("알림 선호 설정", "서버 미연동 · 저장되지 않아요", enabled = false)
        SettingsRow("기기 등록", "푸시 제공자 미연동 · 등록되지 않았어요", enabled = false)
    }
    Text("권한을 확인해도 푸시 수신이 활성화되지는 않아요. 권한 요청이나 기기 등록을 자동 실행하지 않아요.")
}
