package chat.rogi.rogichat.feature.settings

import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.*
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import chat.rogi.rogichat.BuildConfig
import chat.rogi.rogichat.core.design.*
import chat.rogi.rogichat.core.session.AccountSummary
import com.adamglin.PhosphorIcons
import com.adamglin.phosphoricons.Fill
import com.adamglin.phosphoricons.Regular
import com.adamglin.phosphoricons.fill.User
import com.adamglin.phosphoricons.regular.Bell
import com.adamglin.phosphoricons.regular.CaretRight
import com.adamglin.phosphoricons.regular.Moon
import com.adamglin.phosphoricons.regular.Info
import com.adamglin.phosphoricons.regular.ShieldCheck
import com.adamglin.phosphoricons.regular.Code

// MoreScreen's complete profile header / grouped-menu composition adapted for Rogichat.
@Composable
fun SettingsScreen(account: AccountSummary?, appearance: Appearance, onSignIn: () -> Unit,
                   onProfile: (() -> Unit)?, onAccount: (() -> Unit)?, onAppearance: () -> Unit,
                   onNotifications: () -> Unit, onAbout: () -> Unit) {
    ProfileHeader(account, onProfile ?: if (account == null) onSignIn else null)
    if (onAccount != null) SettingsSection("계정") {
        SettingsRow("계정 관리", "로그인 및 SOOP 연결", PhosphorIcons.Regular.ShieldCheck, onClick = onAccount)
    }
    SettingsSection("앱 설정") {
        SettingsRow("화면 모드", appearance.title, PhosphorIcons.Regular.Moon, onClick = onAppearance)
        SettingsRow("알림", "기기의 알림 설정", PhosphorIcons.Regular.Bell, onClick = onNotifications)
    }
    SettingsSection("앱 정보") {
        SettingsRow("로기챗 정보", "버전 및 오픈소스 라이선스", PhosphorIcons.Regular.Info, onClick = onAbout)
    }
}

@Composable
private fun ProfileHeader(account: AccountSummary?, onClick: (() -> Unit)?) {
    Row(Modifier.fillMaxWidth().then(if (onClick != null) Modifier.clickable(role = Role.Button, onClick = onClick) else Modifier)
        .padding(horizontal = 20.dp, vertical = 24.dp), verticalAlignment = Alignment.CenterVertically) {
        Box(Modifier.size(56.dp).clip(RoundedCornerShape(16.dp)).background(MaterialTheme.colorScheme.primaryContainer),
            contentAlignment = Alignment.Center) {
            if (account != null) Text(profileMonogram(account.nickname), style = MaterialTheme.typography.titleLarge,
                color = MaterialTheme.colorScheme.onPrimaryContainer)
            else Icon(PhosphorIcons.Fill.User, null, Modifier.size(26.dp), MaterialTheme.colorScheme.onPrimaryContainer)
        }
        Spacer(Modifier.width(16.dp))
        Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(4.dp)) {
            Text(account?.nickname ?: "로기챗에 오신 것을 환영해요", style = MaterialTheme.typography.titleMedium,
                fontWeight = FontWeight.SemiBold)
            Text(if (account == null) "로그인하고 대화를 시작하세요" else if (account.soopConnected) "SOOP 계정 연결됨" else "SOOP 계정 연결 필요",
                style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
        }
        if (onClick != null) Icon(PhosphorIcons.Regular.CaretRight, null, Modifier.size(18.dp), MaterialTheme.colorScheme.onSurfaceVariant)
    }
}

@Composable
fun AboutScreen(onLicenses: () -> Unit) {
    Column(Modifier.fillMaxWidth().padding(24.dp), horizontalAlignment = Alignment.CenterHorizontally,
        verticalArrangement = Arrangement.spacedBy(8.dp)) {
        Text("로기챗", style = MaterialTheme.typography.headlineMedium)
        Text("가까이 나누는 대화", color = MaterialTheme.colorScheme.onSurfaceVariant)
    }
    SettingsSection("버전") {
        SettingsRow("앱 버전", "${BuildConfig.VERSION_NAME} (${BuildConfig.VERSION_CODE})")
    }
    SettingsSection("소프트웨어") {
        SettingsRow("오픈소스 라이선스", icon = PhosphorIcons.Regular.Code, onClick = onLicenses)
    }
}

internal fun profileMonogram(value: String): String = if (value.isEmpty()) "" else String(Character.toChars(value.codePointAt(0)))
