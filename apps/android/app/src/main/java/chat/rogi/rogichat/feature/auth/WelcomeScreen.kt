package chat.rogi.rogichat.feature.auth

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.*
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.res.painterResource
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import chat.rogi.rogichat.R
import chat.rogi.rogichat.core.design.AppButton
import chat.rogi.rogichat.core.session.SignInProvider

// LoginContent's branding / scroll / spacing / async provider actions adapted from the reference.
// Email/password, unrelated OAuth providers and legacy logo are not Rogichat account contracts.
@Composable
fun WelcomeScreen(providers: Set<SignInProvider>, busy: Boolean, onSignIn: (SignInProvider) -> Unit) {
    Column(Modifier.fillMaxSize().verticalScroll(rememberScrollState()).padding(horizontal = 28.dp),
        horizontalAlignment = Alignment.CenterHorizontally) {
        Spacer(Modifier.height(64.dp))
        Icon(painterResource(R.drawable.ic_launcher), contentDescription = null, tint = androidx.compose.ui.graphics.Color.Unspecified,
            modifier = Modifier.size(88.dp).clip(RoundedCornerShape(24.dp)))
        Spacer(Modifier.height(28.dp))
        Text("로기챗", style = MaterialTheme.typography.headlineLarge, fontWeight = FontWeight.Bold)
        Spacer(Modifier.height(16.dp))
        Text("좋아하는 스트리머와\n가까이 나누는 대화", style = MaterialTheme.typography.headlineMedium,
            textAlign = TextAlign.Center)
        Spacer(Modifier.height(16.dp))
        Text("SOOP 계정을 연결하고\n우리의 이야기를 이어가세요.", style = MaterialTheme.typography.bodyLarge,
            color = MaterialTheme.colorScheme.onSurfaceVariant, textAlign = TextAlign.Center)
        Spacer(Modifier.height(48.dp))
        if (providers.isEmpty()) {
            Surface(color = MaterialTheme.colorScheme.surfaceVariant, shape = MaterialTheme.shapes.medium,
                modifier = Modifier.fillMaxWidth()) {
                Text("현재 버전에서는 앱 로그인을 지원하지 않아요.",
                    style = MaterialTheme.typography.bodyMedium, color = MaterialTheme.colorScheme.onSurfaceVariant,
                    textAlign = TextAlign.Center, modifier = Modifier.padding(20.dp))
            }
        } else {
            providers.forEach { provider ->
                AppButton(onClick = { onSignIn(provider) }, enabled = !busy, modifier = Modifier.fillMaxWidth()) {
                    if (busy) CircularProgressIndicator(Modifier.size(20.dp), strokeWidth = 2.dp)
                    else Text(provider.title)
                }
                Spacer(Modifier.height(12.dp))
            }
            Text("Apple로 시작해도 SOOP 계정 연결이 필요해요.", style = MaterialTheme.typography.bodySmall,
                color = MaterialTheme.colorScheme.onSurfaceVariant, textAlign = TextAlign.Center)
        }
        Spacer(Modifier.height(40.dp))
    }
}

@Composable
fun LinkAccountScreen(busy: Boolean, onConnect: (() -> Unit)?) {
    Column(Modifier.fillMaxSize().verticalScroll(rememberScrollState()).padding(28.dp),
        verticalArrangement = Arrangement.spacedBy(20.dp)) {
        Spacer(Modifier.height(24.dp))
        Text("SOOP 계정을\n연결해 주세요", style = MaterialTheme.typography.headlineLarge)
        Text("스트리머와 대화를 시작하려면 SOOP 계정 확인이 필요해요.",
            style = MaterialTheme.typography.bodyLarge, color = MaterialTheme.colorScheme.onSurfaceVariant)
        Surface(shape = MaterialTheme.shapes.medium, color = MaterialTheme.colorScheme.surfaceVariant) {
            Column(Modifier.padding(20.dp), verticalArrangement = Arrangement.spacedBy(12.dp)) {
                Text("내 계정으로 안전하게", style = MaterialTheme.typography.titleMedium)
                Text("SOOP에서 직접 로그인해 계정을 확인해요. 로기챗은 SOOP 비밀번호를 저장하지 않아요.",
                    color = MaterialTheme.colorScheme.onSurfaceVariant)
            }
        }
        if (onConnect != null) AppButton(onClick = onConnect, enabled = !busy, modifier = Modifier.fillMaxWidth()) {
            if (busy) CircularProgressIndicator(Modifier.size(20.dp), strokeWidth = 2.dp) else Text("SOOP 계정 연결")
        }
    }
}
