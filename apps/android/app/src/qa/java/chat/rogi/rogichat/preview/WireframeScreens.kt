package chat.rogi.rogichat.preview

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.FlowRow
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.material3.Button
import androidx.compose.material3.FilterChip
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import chat.rogi.rogichat.core.design.WireCard
import chat.rogi.rogichat.core.design.ScreenStatus

@Composable
fun LinkWireframe(onPreview: () -> Unit, onSinglePreview: () -> Unit) {
    WireCard("대화를 시작하기 전") {
        Text("1. 로기챗 계정으로 로그인")
        Text("2. 본인의 SOOP 계정 연결")
        Text("3. 참여할 수 있는 대화방 확인")
    }
    Text("Apple 로그인만으로는 대화방을 이용할 수 없어요. SOOP 연결을 완료해야 해요.")
    OutlinedButton(onClick = {}, enabled = false) { Text("SOOP 계정 연결 · 준비 중") }
    Button(onClick = onPreview) { Text("연결 이후 화면 미리보기") }
    OutlinedButton(onClick = onSinglePreview) { Text("방 1개 계정 화면 미리보기") }
    Text("계정이 연결되거나 생성되지 않아요.", style = MaterialTheme.typography.bodySmall)
}

@Composable
fun RoomsWireframe(state: WireframeState, onScenario: (ListScenario) -> Unit, onRoom: (String) -> Unit, onSettings: () -> Unit) {
    Text("${state.role.label} 화면 · 참여 중인 대화방")
    TextButton(onClick = onSettings) { Text("내 프로필 및 설정") }
    FlowRow(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
        ListScenario.entries.forEach { scenario ->
            FilterChip(selected = state.scenario == scenario, onClick = { onScenario(scenario) }, label = { Text(scenario.label) })
        }
    }
    when (state.scenario) {
        ListScenario.CONTENT -> state.visibleRooms.forEach { room ->
            WireCard(room.title) {
                Text(room.summary)
                Text("샘플 대화방", style = MaterialTheme.typography.labelSmall)
                Button(onClick = { onRoom(room.id) }) { Text("대화 보기") }
            }
        }
        ListScenario.LOADING -> ScreenStatus("대화방을 불러오는 중", "위 목록 상태를 바꾸면 다른 화면을 볼 수 있어요.", loading = true)
        ListScenario.EMPTY -> ScreenStatus("아직 참여한 대화방이 없어요", "참여 조건이 확인되면 이곳에 대화방이 표시돼요.")
        ListScenario.ERROR -> ScreenStatus("목록을 불러오지 못했어요", "연결 오류 화면 예시예요.",
            onRetry = { onScenario(ListScenario.CONTENT) })
    }
}

@Composable
fun ChatWireframe(state: WireframeState, onAudience: (PreviewAudience) -> Unit, onTarget: (String) -> Unit,
                  onDraft: (String) -> Unit, onReport: () -> Unit) {
    Text(WireframeFixtures.rooms.first { it.id == state.roomId }.title, style = MaterialTheme.typography.titleLarge)
    Text("오늘 · 샘플 타임라인")
    WireCard("스트리머 · 전체 대화") { Text("오늘도 만나서 반가워요. 편하게 이야기해 주세요.") }
    if (state.role == PreviewRole.FAN) {
        WireCard("나 · 개인 메시지") { Text("오늘 방송도 기대하고 있어요!"); Text("나와 스트리머에게만 보이는 메시지 예시") }
        WireCard("스트리머 · 개인 답장") { Text("고마워요. 곧 만나요!") }
    } else {
        WireframeFixtures.fans.forEach { fan ->
            WireCard("$fan · 개인 메시지") {
                Text("오늘 방송도 기대하고 있어요!")
                TextButton(onClick = { onTarget(fan) }) { Text("이 팬에게 답장 선택") }
            }
        }
    }
    WireCard("메시지 작성") {
        if (state.role == PreviewRole.STREAMER) {
            FlowRow(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                PreviewAudience.entries.forEach { audience ->
                    FilterChip(selected = state.audience == audience, onClick = { onAudience(audience) }, label = { Text(audience.label) })
                }
            }
            Text(if (state.audience == PreviewAudience.SHARED) "대상: 방 참여자 전체" else "대상: ${state.target ?: "위 메시지에서 팬을 선택해 주세요"}")
            Text("대상이 바뀌면 미리보기 입력이 지워져요.", style = MaterialTheme.typography.bodySmall)
        } else Text("대상: 이 방의 스트리머 · 개인 메시지")
        OutlinedTextField(value = state.draft, onValueChange = onDraft, enabled = state.canCompose,
            label = { Text("메시지 입력 연습") }, minLines = 2, maxLines = 5, modifier = Modifier.fillMaxWidth())
        Text("${state.draft.length}/2000 · 입력은 저장되지 않아요", style = MaterialTheme.typography.bodySmall)
        Button(onClick = {}, enabled = false) { Text("전송 · 준비 중") }
        Text("첨부·반응·공개 전환은 추후 연결돼요. 실제 메시지가 전송되지 않아요.", style = MaterialTheme.typography.bodySmall)
    }
    TextButton(onClick = onReport) { Text("신고 및 차단 안내") }
}

@Composable
fun ReportWireframe() {
    var reason by remember { mutableStateOf("스팸 또는 광고") }
    WireCard("신고 사유 미리보기") {
        Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
            listOf("스팸 또는 광고", "괴롭힘 또는 불쾌한 내용", "기타").forEach { item ->
                FilterChip(selected = reason == item, onClick = { reason = item }, label = { Text(item) })
            }
        }
        Text("실제 메시지나 계정이 선택되지 않은 화면 예시예요.")
        Button(onClick = {}, enabled = false) { Text("신고 제출 · 준비 중") }
        OutlinedButton(onClick = {}, enabled = false) { Text("사용자 차단 · 준비 중") }
    }
}
