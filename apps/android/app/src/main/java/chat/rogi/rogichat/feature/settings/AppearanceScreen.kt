package chat.rogi.rogichat.feature.settings

import androidx.compose.foundation.layout.*
import androidx.compose.foundation.selection.selectable
import androidx.compose.foundation.selection.selectableGroup
import androidx.compose.material3.*
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.unit.dp
import chat.rogi.rogichat.core.design.Appearance
import chat.rogi.rogichat.core.design.SettingsDivider

@Composable
fun AppearanceScreen(selected: Appearance, onSelect: (Appearance) -> Unit) {
    Column(Modifier.selectableGroup()) {
        Text("화면 모드", style = MaterialTheme.typography.titleMedium, modifier = Modifier.padding(20.dp))
        Appearance.entries.forEach { mode ->
            Row(Modifier.fillMaxWidth().heightIn(min = 64.dp)
                .selectable(selected == mode, role = Role.RadioButton, onClick = { onSelect(mode) })
                .padding(horizontal = 20.dp, vertical = 12.dp), verticalAlignment = Alignment.CenterVertically) {
                Text(mode.title, Modifier.weight(1f), style = MaterialTheme.typography.bodyLarge)
                RadioButton(selected = selected == mode, onClick = null)
            }
            SettingsDivider()
        }
        Text("시스템 설정을 선택하면 기기의 화면 모드에 맞춰 자동으로 바뀌어요.",
            style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant,
            modifier = Modifier.padding(20.dp))
    }
}
