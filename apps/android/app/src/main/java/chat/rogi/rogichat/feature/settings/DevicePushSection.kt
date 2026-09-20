package chat.rogi.rogichat.feature.settings

import android.Manifest
import android.os.Build
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.layout.*
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.unit.dp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import chat.rogi.rogichat.core.push.*
import chat.rogi.rogichat.core.design.ConfirmationPrompt

@Composable
fun DevicePushSection(manager: NativePushCoordinator, account: NotificationAccountScope, onPreferencesChanged: () -> Unit) {
    if (!manager.providerAvailable) {
        Column(Modifier.fillMaxWidth().padding(20.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
            Text("이 기기의 푸시 연결", style = MaterialTheme.typography.titleLarge)
            Text("현재 버전에서는 이 기기의 푸시 연결을 사용할 수 없어요.", color = MaterialTheme.colorScheme.onSurfaceVariant)
        }
        return
    }
    val published by manager.state.collectAsStateWithLifecycle()
    val state = published.takeIf { it.account == account } ?: DevicePushState(account)
    val context = LocalContext.current
    val permission = remember(context) { AndroidPushPermission(context) }
    var requestedFor by remember { mutableStateOf<NotificationAccountScope?>(null) }
    val launcher = rememberLauncherForActivityResult(ActivityResultContracts.RequestPermission()) {
        // Callback Boolean is not permission proof; provider reads the actual OS state again.
        requestedFor?.let(manager::connect); requestedFor = null
    }
    var confirmEnable by remember(account) { mutableStateOf<chat.rogi.rogichat.core.network.PreferenceGeneration?>(null) }
    var confirmRemove by remember(account) { mutableStateOf(false) }
    LaunchedEffect(state.preferences) { if (state.preferences != null) onPreferencesChanged() }
    LaunchedEffect(account) { manager.refresh(account) }
    Column(Modifier.fillMaxWidth().padding(20.dp), verticalArrangement = Arrangement.spacedBy(10.dp)) {
        Text("이 기기의 푸시 연결", style = MaterialTheme.typography.titleLarge)
        Text(when (state.phase) {
            PushRegistrationState.REGISTERED -> "현재 로그인한 계정에 이 기기를 연결했어요."
            PushRegistrationState.UNAVAILABLE -> "지금은 이 기기의 푸시 연결을 사용할 수 없어요."
            PushRegistrationState.FETCHING, PushRegistrationState.REGISTERING -> "기기 연결을 확인하고 있어요."
            else -> "기기 알림 허용과 계정의 푸시 연결을 확인해요."
        }, color = MaterialTheme.colorScheme.onSurfaceVariant)
        if (state.busy) LinearProgressIndicator(Modifier.fillMaxWidth())
        state.error?.let { Text(it, color = MaterialTheme.colorScheme.error) }
        if (state.phase != PushRegistrationState.REGISTERED) Button(enabled = !state.busy, onClick = {
            if (Build.VERSION.SDK_INT >= 33 && permission.current() == PushPermission.NOT_DETERMINED) {
                requestedFor = account; permission.willRequest(); launcher.launch(Manifest.permission.POST_NOTIFICATIONS)
            } else manager.connect(account)
        }) { Text("기기 푸시 연결") }
        else {
            if (state.preferences?.pushEnabled == false) Button(enabled = !state.busy, onClick = { confirmEnable = state.preferences.generation }) { Text("계정의 푸시 알림 켜기") }
            TextButton(enabled = !state.busy, onClick = { manager.refresh(account) }) { Text("현재 설정 확인") }
            TextButton(enabled = !state.busy, onClick = { confirmRemove = true }) { Text("이 기기 연결 해제") }
        }
    }
    confirmEnable?.let { generation -> ConfirmationPrompt("계정의 푸시 알림을 켤까요?",
        "현재 계정의 푸시 알림을 켜요. 다른 기기와 웹에도 적용되는 설정이에요.", "알림 켜기",
        onDismiss = { confirmEnable = null }, onConfirm = { confirmEnable = null; manager.enable(account, generation) }) }
    if (confirmRemove) ConfirmationPrompt("이 기기의 푸시 연결을 해제할까요?",
        "계정 전체 알림 설정은 유지되고 이 기기의 연결만 해제돼요.", "연결 해제",
        onDismiss = { confirmRemove = false }, onConfirm = { confirmRemove = false; manager.disconnect(account) })
}
