package chat.rogi.rogichat.feature.messageactions

import androidx.activity.compose.BackHandler
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import androidx.lifecycle.ViewModel
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import chat.rogi.rogichat.core.design.*
import chat.rogi.rogichat.core.messageactions.*
import chat.rogi.rogichat.core.session.SessionIdentity

class AccountBlocksModel(val repository: AccountBlocksCoordinator, expected: SessionIdentity) : ViewModel() {
    val handle = repository.open(expected)
}
@Composable
fun AccountBlocksScreen(model: AccountBlocksModel, onBack: () -> Unit) {
    val state by model.handle.state.collectAsStateWithLifecycle()
    val back: () -> Unit = { if (state.room != null) model.repository.rooms(model.handle) else onBack() }
    BackHandler(onBack = back)
    Scaffold(topBar = { AppTopBar(state.room?.label ?: "차단 관리", back) }) { insets ->
        Column(Modifier.fillMaxSize().padding(insets).verticalScroll(rememberScrollState()).padding(20.dp), verticalArrangement = Arrangement.spacedBy(12.dp)) {
            if (state.room == null) {
                when {
                    state.busy -> ScreenStatus("차단 목록을 확인하는 중", "잠시만 기다려 주세요.", loading = true)
                    state.error != null -> ScreenStatus("목록을 확인하지 못했어요", requireNotNull(state.error), onRetry = { model.repository.rooms(model.handle) })
                    state.rooms.isEmpty() -> Text("차단한 사용자가 있는 대화가 없어요.")
                    else -> state.rooms.forEach { room -> SettingsRow(room.label, onClick = { model.repository.select(model.handle, state.roomCycle, room) }) }
                }
            } else {
                val token = state.token
                if (token != null) ActorBlocksPanel(token, state.blocks, state.complete, state.busy, state.error != null,
                    state.unknownActors, state.outcome, { model.repository.refresh(model.handle) }, { model.repository.refresh(model.handle) },
                    { original, actor -> model.repository.unblock(model.handle, original, actor) })
                else if (state.busy) CircularProgressIndicator()
                else ScreenStatus("차단 목록을 확인하지 못했어요", state.error ?: "현재 상태를 다시 확인해 주세요.", onRetry = { model.repository.refresh(model.handle) })
            }
        }
    }
}
