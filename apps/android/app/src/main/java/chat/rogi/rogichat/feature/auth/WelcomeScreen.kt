package chat.rogi.rogichat.feature.auth

import androidx.compose.foundation.layout.ColumnScope
import androidx.compose.foundation.layout.fillMaxWidth
import chat.rogi.rogichat.core.design.AppButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import chat.rogi.rogichat.core.design.WireCard

@Composable
fun ColumnScope.WelcomeScreen() {
    Text("가까이 나누는 대화", style = MaterialTheme.typography.headlineLarge)
    Text("좋아하는 스트리머와 로기챗에서 만나요.")
    WireCard("계정으로 시작하기") {
        AppButton(onClick = {}, enabled = false, modifier = Modifier.fillMaxWidth()) { Text("Apple로 계속하기 · 준비 중") }
        OutlinedButton(onClick = {}, enabled = false, modifier = Modifier.fillMaxWidth()) { Text("SOOP으로 계속하기 · 준비 중") }
        Text("Apple로 시작해도 서비스를 이용하려면 SOOP 계정 연결이 필요해요.")
        Text("현재는 로그인 연동을 준비하고 있어요. 계정 정보는 수집하지 않아요.", style = MaterialTheme.typography.bodySmall)
    }
}
