package chat.rogi.rogichat

import androidx.compose.runtime.*
import chat.rogi.rogichat.core.design.AppShell
import chat.rogi.rogichat.core.navigation.*
import chat.rogi.rogichat.feature.auth.WelcomeScreen
import chat.rogi.rogichat.feature.settings.*

@Composable
fun AppEntry() {
    // No session adapter yet: production access is permanently SignedOut.
    var navigation by remember { mutableStateOf(ShellNavigation()) }
    AppShell(navigation, { navigation = navigation.selectTab(it) }, { navigation = navigation.back() }) {
        when (navigation.page) {
            AppPage.SETTINGS -> SettingsScreen(navigation.access) { navigation = navigation.open(it) }
            AppPage.NOTIFICATIONS -> NotificationSettingsScreen()
            AppPage.ABOUT -> AboutScreen()
            else -> WelcomeScreen()
        }
    }
}
