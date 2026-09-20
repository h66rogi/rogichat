package chat.rogi.rogichat.core.design

import androidx.compose.animation.animateColorAsState
import androidx.compose.animation.core.tween
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.selection.selectable
import androidx.compose.foundation.selection.selectableGroup
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import chat.rogi.rogichat.core.navigation.AppTab
import com.adamglin.PhosphorIcons
import com.adamglin.phosphoricons.Fill
import com.adamglin.phosphoricons.Regular
import com.adamglin.phosphoricons.fill.ChatCircle
import com.adamglin.phosphoricons.fill.GearSix
import com.adamglin.phosphoricons.regular.ChatCircle
import com.adamglin.phosphoricons.regular.GearSix
import com.adamglin.phosphoricons.regular.ArrowLeft

// Adapted from the complete navigation bar/item and top-bar implementations.
// Preserve animated icon selection; add visible labels, tab semantics and scalable height.
@Composable
fun AppNavigationBar(selected: AppTab, onSelect: (AppTab) -> Unit) {
    Surface(Modifier.fillMaxWidth(), color = MaterialTheme.colorScheme.surface) {
        Column {
            HorizontalDivider(color = MaterialTheme.colorScheme.outlineVariant, thickness = 0.5.dp)
            Row(Modifier.navigationBarsPadding().fillMaxWidth().heightIn(min = 64.dp)
                .padding(horizontal = 8.dp).selectableGroup(),
                horizontalArrangement = Arrangement.SpaceAround,
                verticalAlignment = Alignment.CenterVertically) {
                AppTab.entries.forEach { tab ->
                    val chosen = selected == tab
                    val color by animateColorAsState(
                        if (chosen) MaterialTheme.colorScheme.primary else MaterialTheme.colorScheme.onSurfaceVariant,
                        tween(200), label = "tab tint")
                    Column(Modifier.weight(1f).heightIn(min = 56.dp)
                        .selectable(chosen, role = Role.Tab, onClick = { onSelect(tab) })
                        .padding(vertical = 8.dp), horizontalAlignment = Alignment.CenterHorizontally,
                        verticalArrangement = Arrangement.spacedBy(4.dp)) {
                        Icon(when (tab) {
                            AppTab.TALKS -> if (chosen) PhosphorIcons.Fill.ChatCircle else PhosphorIcons.Regular.ChatCircle
                            AppTab.SETTINGS -> if (chosen) PhosphorIcons.Fill.GearSix else PhosphorIcons.Regular.GearSix
                        }, contentDescription = null, modifier = Modifier.size(25.dp), tint = color)
                        Text(tab.label, color = color, style = MaterialTheme.typography.labelSmall,
                            fontWeight = if (chosen) FontWeight.SemiBold else FontWeight.Normal)
                    }
                }
            }
        }
    }
}

@Composable
fun AppTopBar(title: String, onBack: (() -> Unit)? = null, actions: @Composable RowScope.() -> Unit = {}) {
    Surface(Modifier.fillMaxWidth(), color = MaterialTheme.colorScheme.background) {
        Row(Modifier.fillMaxWidth().heightIn(min = 64.dp).padding(horizontal = 16.dp),
            verticalAlignment = Alignment.CenterVertically) {
            if (onBack != null) IconButton(onClick = onBack) {
                Icon(PhosphorIcons.Regular.ArrowLeft, contentDescription = "뒤로가기")
            }
            Text(title, style = if (onBack == null) MaterialTheme.typography.headlineMedium else MaterialTheme.typography.titleLarge,
                fontWeight = FontWeight.Bold, modifier = Modifier.weight(1f).padding(vertical = 8.dp))
            Row(horizontalArrangement = Arrangement.End, content = actions)
        }
    }
}
