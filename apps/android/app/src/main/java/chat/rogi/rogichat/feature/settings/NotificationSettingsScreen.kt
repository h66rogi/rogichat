package chat.rogi.rogichat.feature.settings

import android.content.ActivityNotFoundException
import androidx.compose.foundation.layout.*
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.unit.dp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import chat.rogi.rogichat.core.design.*
import com.adamglin.PhosphorIcons
import com.adamglin.phosphoricons.Regular
import com.adamglin.phosphoricons.regular.Bell

// NotificationSettingsScreen's system settings action, separators and error handling reused.
@Composable
fun NotificationSettingsScreen(model: NotificationSettingsViewModel? = null) {
    val context = LocalContext.current
    val system = remember(context) { NotificationSystem(context) }
    val epoch = LocalForegroundEpoch.current
    var lastAccountRefresh by remember(model) { mutableLongStateOf(epoch) }
    LaunchedEffect(model, epoch) {
        if (lastAccountRefresh != epoch) { lastAccountRefresh = epoch; model?.loadPreferences() }
    }
    var state by remember { mutableStateOf(NotificationReadState()) }
    var openFailure by remember { mutableStateOf<String?>(null) }
    val refresh = {
        state = state.begin()
        val ticket = state.revision
        try { state = state.finish(ticket, system.read()) }
        catch (_: SecurityException) { state = state.fail(ticket) }
    }
    LaunchedEffect(epoch) { refresh() }
    DisposableEffect(Unit) { onDispose { state = state.cancel() } }
    if (model != null) {
        val account by model.uiState.collectAsStateWithLifecycle()
        AccountNotificationSettings(account, model::loadPreferences, model::disablePush)
        SettingsDivider()
    }
    NotificationSettingsContent(state, openFailure, onRead = refresh, onOpen = {
        try { system.openSettings(); openFailure = null }
        catch (_: ActivityNotFoundException) { openFailure = "설정을 열지 못했어요. 기기 설정에서 로기챗을 선택해 주세요." }
        catch (_: SecurityException) { openFailure = "기기에서 설정 화면을 열 수 없어요." }
    })
}

/** Meloming's account settings section, loading/error presentation and explicit system action.
 * Only server-confirmed disable is available; device permission is rendered independently below.
 */
@Composable
private fun AccountNotificationSettings(state: NotificationSettingsUiState, onReload: () -> Unit, onDisable: () -> Unit) {
    var confirmDisable by remember { mutableStateOf(false) }
    if (confirmDisable && state.canDisable) ConfirmationPrompt("모든 기기에서 알림을 끌까요?",
        "이 계정의 푸시 알림이 웹과 다른 기기에서도 꺼져요. 기기의 알림 허용 설정은 바뀌지 않아요.", "알림 끄기",
        onDismiss = { confirmDisable = false }, onConfirm = { confirmDisable = false; onDisable() })
    LaunchedEffect(state.canDisable) { if (!state.canDisable) confirmDisable = false }
    Column(Modifier.fillMaxWidth().padding(20.dp), verticalArrangement = Arrangement.spacedBy(12.dp)) {
        Text("계정의 푸시 알림", style = MaterialTheme.typography.titleLarge)
        Text("웹과 다른 기기에도 적용되는 계정 설정이에요.", color = MaterialTheme.colorScheme.onSurfaceVariant)
        val preferences = state.preferences
        if (preferences != null) {
            val status = if (preferences.pushEnabled) "켜짐" else "꺼짐"
            Text(if (state.needsRefresh || state.isLoading) "마지막으로 확인한 설정: $status" else "계정 알림 $status",
                style = MaterialTheme.typography.bodyLarge)
        }
        if (state.isLoading || state.isSaving) {
            Row(horizontalArrangement = Arrangement.spacedBy(12.dp)) {
                CircularProgressIndicator(Modifier.size(20.dp))
                Text(if (state.isSaving) "설정을 저장하고 있어요." else "계정 설정을 확인하고 있어요.")
            }
        }
        state.error?.let { Text(it, color = MaterialTheme.colorScheme.error) }
        if (state.canDisable) OutlinedButton(onClick = { confirmDisable = true }) { Text("모든 기기에서 알림 끄기") }
        if (!state.isLoading && !state.isSaving && (state.needsRefresh || state.error != null))
            TextButton(onClick = onReload) { Text("최신 설정 확인") }
    }
}

@Composable
fun NotificationSettingsContent(state: NotificationReadState, openFailure: String? = null,
                                onRead: (() -> Unit)? = null, onOpen: (() -> Unit)? = null) {
    Column(Modifier.fillMaxWidth().padding(20.dp), verticalArrangement = Arrangement.spacedBy(12.dp)) {
        Icon(PhosphorIcons.Regular.Bell, null, Modifier.size(32.dp), MaterialTheme.colorScheme.primary)
        Text("이 기기의 알림", style = MaterialTheme.typography.titleLarge)
        if (state.reading) CircularProgressIndicator(Modifier.size(24.dp))
        else Text(if (state.failed) "알림 상태를 확인하지 못했어요." else when (state.snapshot?.authorization) {
            NotificationAuthorization.ALLOWED -> "기기에서 로기챗 알림을 허용하고 있어요."
            NotificationAuthorization.DENIED -> "기기에서 로기챗 알림이 꺼져 있어요."
            else -> "기기 설정에서 알림 허용 상태를 확인할 수 있어요."
        }, color = MaterialTheme.colorScheme.onSurfaceVariant)
        val blocked = state.snapshot?.blockedChannels ?: 0
        if (blocked > 0) Text("일부 알림 유형이 꺼져 있어요. 기기 설정에서 확인해 주세요.",
            color = MaterialTheme.colorScheme.onSurfaceVariant)
        if (state.failed && onRead != null) TextButton(onClick = onRead) { Text("다시 확인") }
    }
    SettingsDivider()
    if (onOpen != null) SettingsRow("기기 알림 설정", "이 기기에서 제공하는 로기챗 알림 설정을 확인해요.", onClick = onOpen)
    if (openFailure != null) Text(openFailure, color = MaterialTheme.colorScheme.error,
        modifier = Modifier.padding(20.dp))
}
