package chat.rogi.rogichat.core.design

import androidx.compose.foundation.isSystemInDarkTheme
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ColumnScope
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedCard
import androidx.compose.material3.Text
import androidx.compose.material3.darkColorScheme
import androidx.compose.material3.lightColorScheme
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.unit.dp

@Composable
fun WireframeTheme(content: @Composable () -> Unit) {
    val colors = if (isSystemInDarkTheme()) darkColorScheme(
        primary = Color(0xFFE2E2E2), onPrimary = Color(0xFF202020),
        secondaryContainer = Color(0xFF383838), onSecondaryContainer = Color.White,
    ) else lightColorScheme(
        primary = Color(0xFF303030), onPrimary = Color.White,
        secondaryContainer = Color(0xFFEAEAEA), onSecondaryContainer = Color(0xFF202020),
        background = Color(0xFFFAFAFA), surface = Color(0xFFFAFAFA),
    )
    MaterialTheme(colorScheme = colors, content = content)
}

@Composable
fun WireCard(title: String, content: @Composable ColumnScope.() -> Unit) {
    OutlinedCard(Modifier.fillMaxWidth()) {
        Column(Modifier.padding(16.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
            Text(title, style = MaterialTheme.typography.titleMedium)
            content()
        }
    }
}
