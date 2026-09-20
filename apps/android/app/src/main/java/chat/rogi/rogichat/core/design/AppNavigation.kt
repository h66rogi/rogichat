package chat.rogi.rogichat.core.design

import androidx.compose.foundation.layout.*
import androidx.compose.foundation.selection.selectable
import androidx.compose.foundation.selection.selectableGroup
import androidx.compose.material3.*
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import chat.rogi.rogichat.core.navigation.AppTab

// Adapted implementation units; provenance R01/R02 in docs/mobile-reuse-audit.md.
@Composable
fun AppNavigationBar(selected: AppTab, onSelect: (AppTab) -> Unit) {
    Surface(Modifier.fillMaxWidth(), color = MaterialTheme.colorScheme.background) {
        Row(Modifier.navigationBarsPadding().fillMaxWidth().heightIn(min = 56.dp)
            .padding(horizontal = 8.dp).selectableGroup(),
            horizontalArrangement = Arrangement.SpaceAround, verticalAlignment = Alignment.CenterVertically) {
            AppTab.entries.forEach { tab ->
                Box(Modifier.weight(1f).heightIn(min = 56.dp)
                    .selectable(selected = selected == tab, role = Role.Tab, onClick = { onSelect(tab) })
                    .padding(12.dp), contentAlignment = Alignment.Center) {
                    Text(tab.label, color = if (selected == tab) MaterialTheme.colorScheme.primary else MaterialTheme.colorScheme.onSurfaceVariant,
                        fontWeight = if (selected == tab) FontWeight.Bold else FontWeight.Normal)
                }
            }
        }
    }
}

@Composable
fun AppTopBar(title: String, onBack: (() -> Unit)? = null) {
    Surface(Modifier.fillMaxWidth(), color = MaterialTheme.colorScheme.background) {
        Row(Modifier.fillMaxWidth().heightIn(min = 56.dp).padding(horizontal = 16.dp),
            verticalAlignment = Alignment.CenterVertically) {
            if (onBack != null) TextButton(onClick = onBack) { Text("뒤로") }
            Text(title, style = MaterialTheme.typography.headlineSmall, fontWeight = FontWeight.Bold,
                modifier = Modifier.weight(1f).padding(vertical = 8.dp))
        }
    }
}
