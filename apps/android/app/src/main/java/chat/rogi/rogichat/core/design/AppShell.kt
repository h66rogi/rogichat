package chat.rogi.rogichat.core.design

import androidx.activity.compose.BackHandler
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.Scaffold
import androidx.compose.runtime.Composable
import androidx.compose.runtime.key
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import chat.rogi.rogichat.core.navigation.*

@Composable
fun AppShell(navigation: ShellNavigation, onTab: (AppTab) -> Unit, onBack: () -> Unit,
             banner: @Composable () -> Unit = {}, content: @Composable ColumnScope.() -> Unit) {
    BackHandler(navigation.canGoBack, onBack = onBack)
    AppForeground {
        Scaffold(bottomBar = { AppNavigationBar(navigation.tab, onTab) }) { insets ->
            Column(Modifier.fillMaxSize().padding(insets).imePadding()) {
                banner()
                AppTopBar(navigation.page.title, if (navigation.canGoBack) onBack else null)
                key(navigation.tab, navigation.page) {
                    Column(Modifier.weight(1f).verticalScroll(rememberScrollState()).padding(20.dp),
                        verticalArrangement = Arrangement.spacedBy(16.dp), content = content)
                }
            }
        }
    }
}
