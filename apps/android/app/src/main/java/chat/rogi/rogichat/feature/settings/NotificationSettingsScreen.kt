package chat.rogi.rogichat.feature.settings

import android.app.NotificationManager
import android.content.ActivityNotFoundException
import android.content.Intent
import android.provider.Settings
import androidx.compose.material3.Text
import androidx.compose.runtime.*
import androidx.compose.ui.platform.LocalContext
import androidx.lifecycle.Lifecycle
import androidx.lifecycle.LifecycleEventObserver
import androidx.lifecycle.compose.LocalLifecycleOwner
import chat.rogi.rogichat.core.design.SettingsRow
import chat.rogi.rogichat.core.design.SettingsSection

@Composable
fun NotificationSettingsScreen() {
    val context = LocalContext.current
    val lifecycleOwner = LocalLifecycleOwner.current
    var observing by remember { mutableStateOf(false) }
    var status by remember { mutableStateOf("아직 확인하지 않았어요") }
    var failure by remember { mutableStateOf<String?>(null) }
    val refresh = {
        val manager = context.getSystemService(NotificationManager::class.java)
        val channels = manager.notificationChannels
        status = if (!manager.areNotificationsEnabled()) "이 기기에서 알림이 허용되지 않았어요"
        else if (channels.isEmpty()) "기기 알림 허용 · 서비스 알림 채널은 아직 없어요"
        else "기기 알림 허용 · 차단된 채널 ${channels.count { it.importance == NotificationManager.IMPORTANCE_NONE }}개"
    }
    DisposableEffect(lifecycleOwner, observing) {
        val observer = LifecycleEventObserver { _, event ->
            if (observing && event == Lifecycle.Event.ON_RESUME) refresh()
        }
        lifecycleOwner.lifecycle.addObserver(observer)
        onDispose { lifecycleOwner.lifecycle.removeObserver(observer) }
    }
    SettingsSection("이 기기의 OS 설정") {
        SettingsRow("알림 권한 확인", status) { observing = true; refresh() }
        SettingsRow("시스템 알림 설정 열기", "기기 설정을 직접 확인해요") {
            observing = true
            try {
                context.startActivity(Intent(Settings.ACTION_APP_NOTIFICATION_SETTINGS).putExtra(Settings.EXTRA_APP_PACKAGE, context.packageName))
                failure = null
            } catch (_: ActivityNotFoundException) { failure = "시스템 설정을 열지 못했어요. 기기 설정에서 로기챗을 찾아주세요." }
            catch (_: SecurityException) { failure = "기기에서 설정 화면 접근을 허용하지 않았어요." }
        }
    }
    if (failure != null) Text(failure!!)
    SettingsSection("서비스 연결") {
        SettingsRow("알림 선호 설정", "서버 미연동 · 저장되지 않아요", enabled = false)
        SettingsRow("기기 등록", "푸시 제공자 미연동 · 등록되지 않았어요", enabled = false)
    }
    Text("권한을 확인해도 푸시 수신이 활성화되지는 않아요. 권한 요청이나 기기 등록을 자동 실행하지 않아요.")
}
