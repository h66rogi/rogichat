package chat.rogi.rogichat

import androidx.activity.ComponentActivity
import androidx.activity.SystemBarStyle
import androidx.activity.enableEdgeToEdge
import androidx.activity.compose.LocalActivity
import androidx.compose.foundation.isSystemInDarkTheme
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.unit.dp
import androidx.lifecycle.viewmodel.compose.LocalViewModelStoreOwner
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.lifecycle.viewmodel.compose.viewModel
import androidx.navigation.NavGraph.Companion.findStartDestination
import androidx.navigation.compose.NavHost
import androidx.navigation.compose.composable
import androidx.navigation.compose.currentBackStackEntryAsState
import androidx.navigation.compose.rememberNavController
import chat.rogi.rogichat.core.design.*
import chat.rogi.rogichat.core.navigation.*
import chat.rogi.rogichat.core.session.*
import chat.rogi.rogichat.feature.auth.*
import chat.rogi.rogichat.feature.rooms.*
import chat.rogi.rogichat.feature.settings.*

/** The sole product composition for both QA and prod. Only build configuration differs. */
@Composable
fun AppEntry(services: ProductServices? = null,
             roomContent: (@Composable (String, () -> Unit) -> Unit)? = null) {
    val context = LocalContext.current
    val product = services ?: remember { ProductServices.installed() }
    val preferences = remember(context.applicationContext) { AppearancePreferences(context.applicationContext) }
    val appearance by preferences.mode.collectAsStateWithLifecycle()
    val dark = when (appearance) { Appearance.SYSTEM -> isSystemInDarkTheme(); Appearance.LIGHT -> false; Appearance.DARK -> true }
    val activity = LocalActivity.current as? ComponentActivity
    SideEffect {
        activity?.enableEdgeToEdge(
            statusBarStyle = SystemBarStyle.auto(android.graphics.Color.TRANSPARENT, android.graphics.Color.TRANSPARENT) { dark },
            navigationBarStyle = SystemBarStyle.auto(0xE6FFFFFF.toInt(), 0x801B1B1B.toInt()) { dark },
        )
    }
    RogichatTheme(darkTheme = dark) {
        AppForeground {
            val session by product.session.collectAsStateWithLifecycle()
            val accountModel: SessionViewModel = viewModel { SessionViewModel(product) }
            val operation by accountModel.state.collectAsStateWithLifecycle()
            LaunchedEffect(accountModel) { accountModel.start() }
            // Every account/access scope owns a fresh nav graph and feature ViewModels.
            // Restored private routes cannot cross a logout/relink/account boundary.
            val featureScope: SessionFeatureScope = viewModel { SessionFeatureScope() }
            val scopeKey = SessionScopeKey(session.generation, session.access, session.account?.id)
            val scopeOwner = featureScope.ownerFor(scopeKey)
            key(scopeKey) {
                CompositionLocalProvider(LocalViewModelStoreOwner provides scopeOwner) {
                    ProductNavigation(product, session, accountModel, operation, appearance, preferences::select, roomContent)
                }
            }
        }
    }
}

// Adapted complete MelomingNavHost bottom-tab stack saving, single-top and NavHost composition.
// Product graph is Rogichat-only; web navigation, feature flags and business routes are excluded.
@Composable
private fun ProductNavigation(services: ProductServices, session: SessionSnapshot, sessionModel: SessionViewModel,
                              operation: SessionOperationState, appearance: Appearance, onAppearance: (Appearance) -> Unit,
                              roomContent: (@Composable (String, () -> Unit) -> Unit)?) {
    val nav = rememberNavController()
    val entry by nav.currentBackStackEntryAsState()
    val route = entry?.destination?.route
    val snackbar = remember { SnackbarHostState() }
    LaunchedEffect(operation.error) { operation.error?.let { snackbar.showSnackbar(it); sessionModel.dismissError() } }
    val topLevel = route in setOf(null, "talks", "settings")
    val privateAccount = session.account.takeIf { session.access in setOf(ShellAccess.READY, ShellAccess.LINK_REQUIRED) }
    fun open(value: String) { nav.navigate(value) { launchSingleTop = true } }
    Scaffold(snackbarHost = { SnackbarHost(snackbar) }, bottomBar = {
        if (topLevel) AppNavigationBar(if (route == "settings") AppTab.SETTINGS else AppTab.TALKS) { tab ->
            nav.navigate(if (tab == AppTab.TALKS) "talks" else "settings") {
                popUpTo(nav.graph.findStartDestination().id) { saveState = true }
                launchSingleTop = true
                restoreState = true
            }
        }
    }) { insets ->
        NavHost(navController = nav, startDestination = "talks", modifier = Modifier.padding(insets)) {
            composable("talks") {
                ProductPage(if (session.access == ShellAccess.SIGNED_OUT) "로기챗" else "대화", scroll = false) {
                    when (session.access) {
                        ShellAccess.SIGNED_OUT -> WelcomeScreen(services.actions?.providers.orEmpty(), operation.busy, sessionModel::signIn)
                        ShellAccess.LINK_REQUIRED -> LinkAccountScreen(operation.busy, if (services.actions?.canLinkSoop == true) sessionModel::linkSoop else null)
                        ShellAccess.READY -> if (services.rooms != null && roomContent != null) {
                            val roomsModel: RoomsViewModel = viewModel { RoomsViewModel(services.rooms, requireNotNull(privateAccount).id) }
                            RoomsScreen(roomsModel) { open("room/${android.net.Uri.encode(it)}") }
                        } else ScreenStatus("대화를 열 수 없어요", "대화 서비스에 연결할 수 없어요.")
                        ShellAccess.RESTORING -> ScreenStatus("계정을 확인하는 중", "잠시만 기다려 주세요.", loading = true)
                        ShellAccess.RETRYABLE_FAILURE -> ScreenStatus("계정을 확인하지 못했어요", "연결 상태를 확인하고 다시 시도해 주세요.",
                            onRetry = if (services.actions?.canRestore == true && !operation.busy) sessionModel::restore else null)
                        ShellAccess.BLOCKED -> ScreenStatus("계정 이용이 제한되었어요", "현재 이 계정으로 대화를 이용할 수 없어요.")
                        ShellAccess.ACCOUNT_CLOSING -> ScreenStatus("탈퇴 처리 중이에요", "탈퇴 처리 중에는 대화를 이용할 수 없어요.")
                    }
                }
            }
            composable("settings") {
                ProductPage("설정") {
                    SettingsScreen(privateAccount, appearance, onSignIn = { open("talks") },
                        onProfile = if (session.access == ShellAccess.READY && services.profiles != null) ({ open("profile") }) else null,
                        onAccount = if (privateAccount != null) ({ open("account") }) else null,
                        onAppearance = { open("appearance") }, onNotifications = { open("notifications") }, onAbout = { open("about") })
                }
            }
            composable("appearance") { ProductPage("화면 모드", { nav.popBackStack() }) { AppearanceScreen(appearance, onAppearance) } }
            composable("notifications") { ProductPage("알림 설정", { nav.popBackStack() }) { NotificationSettingsScreen() } }
            composable("about") { ProductPage("로기챗 정보", { nav.popBackStack() }) { AboutScreen { open("licenses") } } }
            composable("licenses") { ProductPage("오픈소스 라이선스", { nav.popBackStack() }) { LicensesScreen() } }
            composable("profile") {
                if (session.access == ShellAccess.READY && privateAccount != null && services.profiles != null) {
                    val model: ProfileViewModel = viewModel { ProfileViewModel(services.profiles, privateAccount.id) }
                    ProfileScreen(model) { nav.popBackStack() }
                } else LaunchedEffect(Unit) { nav.popBackStack() }
            }
            composable("account") {
                if (privateAccount != null) ProductPage("계정 관리", { nav.popBackStack() }) {
                    AccountScreen(privateAccount, operation.busy,
                        if (services.actions?.canSignOut == true) sessionModel::signOut else null,
                        if (services.actions?.canCloseAccount == true) sessionModel::closeAccount else null,
                        if (!privateAccount.soopConnected && !operation.busy && services.actions?.canLinkSoop == true) sessionModel::linkSoop else null)
                } else LaunchedEffect(Unit) { nav.popBackStack() }
            }
            composable("room/{roomId}") { backStack ->
                if (session.access == ShellAccess.READY && roomContent != null) {
                    backStack.arguments?.getString("roomId")?.let { roomContent(it) { nav.popBackStack() } }
                } else LaunchedEffect(Unit) { nav.popBackStack() }
            }
        }
    }
}

@Composable
private fun ProductPage(title: String, onBack: (() -> Unit)? = null, scroll: Boolean = true,
                        content: @Composable ColumnScope.() -> Unit) {
    Column(Modifier.fillMaxSize()) {
        AppTopBar(title, onBack)
        Column(Modifier.weight(1f).fillMaxWidth()
            .then(if (scroll) Modifier.verticalScroll(rememberScrollState()) else Modifier), content = content)
    }
}
