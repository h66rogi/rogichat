package chat.rogi.rogichat.feature.identity

import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.material3.Button
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.unit.dp

/** OS session writer mounts with actual Apple browser and SOOP link actions. */
@Composable
fun IdentityEntrySection(appleAvailable: Boolean, busy: Boolean, soopRequired: Boolean,
                         beginApple: () -> Unit, beginSOOPLink: () -> Unit) {
    Column(verticalArrangement = Arrangement.spacedBy(12.dp)) {
        if (soopRequired) {
            Text("SOOP 계정 연결이 필요해요")
            Text("Apple 로그인은 완료했어요. 채팅을 이용하려면 SOOP 계정을 연결해 주세요. 연결 전에도 계정 관리와 로그아웃, 탈퇴를 이용할 수 있어요.")
            Button(onClick = beginSOOPLink, enabled = !busy) { Text("SOOP 계정 연결") }
        } else if (appleAvailable) {
            Button(onClick = beginApple, enabled = !busy) { Text("Apple로 계속") }
        } else {
            Text("지금은 Apple 로그인에 연결할 수 없어요. SOOP 로그인을 이용하거나 잠시 후 다시 시도해 주세요.")
        }
    }
}
