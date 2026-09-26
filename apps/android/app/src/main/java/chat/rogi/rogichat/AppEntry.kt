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
import kotlinx.coroutines.launch
import androidx.lifecycle.viewmodel.compose.LocalViewModelStoreOwner
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.lifecycle.viewmodel.compose.viewModel
import androidx.navigation.NavGraph.Companion.findStartDestination
import androidx.navigation.compose.NavHost
import androidx.navigation.compose.composable
import androidx.navigation.compose.currentBackStackEntryAsState
import androidx.navigation.compose.rememberNavController
import chat.rogi.rogichat.core.auth.*
import chat.rogi.rogichat.core.conversation.*
import chat.rogi.rogichat.feature.conversation.*
import chat.rogi.rogichat.core.deletion.*
import chat.rogi.rogichat.core.design.*
import chat.rogi.rogichat.core.navigation.*
import chat.rogi.rogichat.core.session.*
import chat.rogi.rogichat.core.rooms.RoomsAccountScope
import chat.rogi.rogichat.feature.auth.*
import chat.rogi.rogichat.feature.rooms.*
import chat.rogi.rogichat.feature.channel.ChannelDetailScreen
import chat.rogi.rogichat.feature.channel.ChannelDetailViewModel
import chat.rogi.rogichat.feature.settings.*

/** The sole product composition for both QA and prod. Only build configuration differs. */
@Composable
fun AppEntry(services: ProductServices? = null,
             roomContent: (@Composable (String, () -> Unit) -> Unit)? = null) {
    val context = LocalContext.current
    val product = services ?: remember { ProductServices.installed(context.applicationContext) }
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
            product.auth?.let { auth ->
                val browser by auth.browserLaunch.collectAsStateWithLifecycle()
                LaunchedEffect(browser) {
                    browser?.let { requested ->
                        try {
                            auth.claimBrowserLaunch(requested.state)?.let { launch ->
                                if (!ExternalBrowserHandler.openUrl(context, launch.url)) auth.browserFailed(launch.state)
                            }
                        } catch (cancelled: kotlinx.coroutines.CancellationException) { throw cancelled }
                        catch (_: Exception) { auth.browserFailed(requested.state) }
                    }
                }
            }
            val foregroundEpoch = LocalForegroundEpoch.current
            LaunchedEffect(accountModel, foregroundEpoch) { if (foregroundEpoch > 0) accountModel.foreground() }
            val lifecycleOwner = androidx.lifecycle.compose.LocalLifecycleOwner.current
            DisposableEffect(lifecycleOwner, accountModel) {
                val observer = androidx.lifecycle.LifecycleEventObserver { _, event ->
                    if (event == androidx.lifecycle.Lifecycle.Event.ON_STOP) accountModel.background()
                    if (event == androidx.lifecycle.Lifecycle.Event.ON_START) accountModel.foreground()
                }
                lifecycleOwner.lifecycle.addObserver(observer)
                if (lifecycleOwner.lifecycle.currentState.isAtLeast(androidx.lifecycle.Lifecycle.State.STARTED)) accountModel.foreground()
                onDispose { lifecycleOwner.lifecycle.removeObserver(observer); accountModel.background() }
            }
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
    val authState = services.auth?.authState?.collectAsStateWithLifecycle()?.value ?: AuthUiState()
    val deletionState = services.deletion?.deletionState?.collectAsStateWithLifecycle()?.value ?: DeletionState()
    val dismissedDeletion by sessionModel.dismissedDeletionKey.collectAsStateWithLifecycle()
    val presentedDeletion = deletionState.presentedFor(session.account?.id, dismissedDeletion)
    val renderedIdentity = SessionIdentity.from(session)
    val renderedDeletionReset = DeletionResetIntent.from(session, deletionState)
    var confirmDeletionReset by remember { mutableStateOf<DeletionResetIntent?>(null) }
    confirmDeletionReset?.let { original -> ConfirmationPrompt("이 기기의 계정 정보를 초기화할까요?",
        "이 기기의 로그인 정보와 탈퇴 요청 내역이 지워져요. 이미 신청한 탈퇴는 취소되지 않아요.", "계정 정보 지우기",
        onDismiss = { confirmDeletionReset = null }, onConfirm = { confirmDeletionReset = null; sessionModel.resetDeletionData(original) }, enabled = !deletionState.busy) }
    var confirmReset by remember { mutableStateOf<SessionIdentity?>(null) }
    var confirmReauthentication by remember { mutableStateOf<SessionIdentity?>(null) }
    confirmReset?.let { original -> ConfirmationPrompt("이 기기의 로그인 정보를 지울까요?",
        "저장된 로그인 정보를 지우고 다시 로그인해야 해요. 서버의 계정이나 대화는 삭제되지 않아요.", "로그인 정보 지우기",
        onDismiss = { confirmReset = null }, onConfirm = { confirmReset = null; sessionModel.resetLocalSession(original) }, enabled = !operation.busy) }
    confirmReauthentication?.let { original -> ConfirmationPrompt("로그아웃 후 다시 로그인할까요?",
        "현재 기기에서 로그아웃해요. 로그인 화면에서 이용 안내를 확인한 뒤 SOOP 계정을 직접 선택해 주세요.", "로그아웃",
        onDismiss = { confirmReauthentication = null }, onConfirm = { confirmReauthentication = null; sessionModel.signOut(original) }, enabled = !operation.busy) }
    val conversationNavigation: ConversationNavigation = viewModel { ConversationNavigation() }
    val nav = rememberNavController()
    val entry by nav.currentBackStackEntryAsState()
    val route = entry?.destination?.route
    val snackbar = remember { SnackbarHostState() }
    LaunchedEffect(operation.error) { operation.error?.let { snackbar.showSnackbar(it); sessionModel.dismissError() } }
    val topLevel = route in setOf(null, "talks", "channel", "settings")
    val privateAccount = session.account.takeIf { session.access in setOf(ShellAccess.READY, ShellAccess.LINK_REQUIRED) }
    val showsSessionStatus = presentedDeletion.visible || authState.active || authState.error != null ||
        (session.validationNeedsRetry && privateAccount != null)
    fun open(value: String) { nav.navigate(value) { launchSingleTop = true } }
    Scaffold(snackbarHost = { SnackbarHost(snackbar) }, topBar = {
        if (showsSessionStatus) Column(Modifier.windowInsetsPadding(
            WindowInsets.safeDrawing.only(WindowInsetsSides.Top + WindowInsetsSides.Horizontal),
        )) {
        AccountDeletionStatus(presentedDeletion, sessionModel::retryDeletionCleanup, { confirmDeletionReset = renderedDeletionReset }, sessionModel::acknowledgeDeletion,
            if (privateAccount != null) ({ confirmReauthentication = renderedIdentity }) else null)
        if (authState.active || authState.error != null) AuthStatusBanner(authState, sessionModel::cancelAuthentication,
            onReauthenticate = if (privateAccount != null && authState.error in setOf(AuthProblem.TERMS, AuthProblem.RECENT_AUTH))
                ({ confirmReauthentication = renderedIdentity }) else null)
        if (session.validationNeedsRetry && privateAccount != null) Surface(color = MaterialTheme.colorScheme.surfaceVariant) {
            Row(Modifier.fillMaxWidth().padding(horizontal = 16.dp, vertical = 8.dp),
                verticalAlignment = androidx.compose.ui.Alignment.CenterVertically) {
                Text(session.notice.orEmpty(), Modifier.weight(1f), style = MaterialTheme.typography.bodySmall)
                TextButton(onClick = sessionModel::retryValidation, enabled = !operation.busy) { Text("다시 시도") }
            }
        }
        }
    }, bottomBar = {
        if (topLevel) AppNavigationBar(when (route) { "channel" -> AppTab.CHANNEL; "settings" -> AppTab.SETTINGS; else -> AppTab.TALKS }) { tab ->
            nav.navigate(when (tab) { AppTab.TALKS -> "talks"; AppTab.CHANNEL -> "channel"; AppTab.SETTINGS -> "settings" }) {
                popUpTo(nav.graph.findStartDestination().id) { saveState = true }
                launchSingleTop = true
                restoreState = true
            }
        }
    }) { insets ->
        NavHost(navController = nav, startDestination = "talks",
            modifier = Modifier.padding(insets).consumeWindowInsets(insets)) {
            composable("talks") {
                ProductPage(if (session.access == ShellAccess.SIGNED_OUT) "로기챗" else "대화", scroll = false,
                    showTopBar = session.access != ShellAccess.READY) {
                    when (session.access) {
                        ShellAccess.SIGNED_OUT -> WelcomeScreen(services.actions?.providers.orEmpty(), operation.busy || authState.active || deletionState.blocksSession, sessionModel::signIn, session.notice, services.access?.let { sessionModel::password }, services.auth?.rulesUrl)
                        ShellAccess.LINK_REQUIRED -> LinkAccountScreen(operation.busy || authState.active, if (services.actions?.canLinkSoop == true) sessionModel::linkSoop else null)
                        ShellAccess.READY -> if (services.rooms != null && session.accountPartition != null) {
                            val roomsModel: RoomsViewModel = viewModel { RoomsViewModel(services.rooms, RoomsAccountScope(requireNotNull(privateAccount).id, session.generation, requireNotNull(session.accountPartition))) }
                            RoomsScreen(roomsModel, onOpenSettings = { open("settings") }, onOpen = services.conversations?.let {
                                { membership, renderedCycle ->
                                    conversationNavigation.selected = ConversationSelection(RoomsAccountScope(requireNotNull(privateAccount).id,
                                        session.generation, requireNotNull(session.accountPartition)), membership, renderedCycle)
                                    open("room/${membership.roomId.value}")
                                }
                            })
                        } else ScreenStatus("대화 목록을 확인할 수 없어요", "계정 정보를 다시 확인해 주세요.",
                            onRetry = if (services.actions?.canRestore == true && !operation.busy) sessionModel::restore else null)
                        ShellAccess.RESTORING -> ScreenStatus("계정을 확인하는 중", "잠시만 기다려 주세요.", loading = true)
                        ShellAccess.RETRYABLE_FAILURE -> {
                            ScreenStatus("계정을 확인하지 못했어요", if (session.storageFailure) "기기에 저장된 로그인 정보를 읽거나 지우지 못했어요." else "연결 상태를 확인하고 다시 시도해 주세요.",
                                onRetry = if (services.actions?.canRestore == true && !operation.busy) sessionModel::restore else null)
                            if (session.storageFailure) TextButton(onClick = { if (services.deletion != null && deletionState.storageFailure) confirmDeletionReset = renderedDeletionReset else confirmReset = renderedIdentity }, enabled = !operation.busy,
                                modifier = Modifier.fillMaxWidth()) { Text("기기의 로그인 정보 지우기") }
                        }
                        ShellAccess.BLOCKED -> ScreenStatus("계정 이용이 제한되었어요", "현재 이 계정으로 대화를 이용할 수 없어요.")
                        ShellAccess.ACCOUNT_CLOSING -> ScreenStatus("탈퇴 처리 중이에요", "탈퇴 처리 중에는 대화를 이용할 수 없어요.")
                    }
                }
            }
            composable("channel") {
                val repository = services.channel
                if (repository != null) {
                    val model: ChannelDetailViewModel = viewModel { ChannelDetailViewModel(repository) }
                    ProductPage("채널", scroll = false, showTopBar = false) { ChannelDetailScreen(model) { open("talks") } }
                } else ProductPage("채널", scroll = false, tabHeader = true) {
                    ScreenStatus("채널을 불러올 수 없어요", "잠시 후 다시 시도해 주세요.")
                }
            }
            composable("settings") {
                val profileModel: ProfileViewModel? = if (privateAccount != null && services.profiles != null)
                    viewModel { ProfileViewModel(services.profiles, privateAccount.id, autoLoad = false) } else null
                ProductPage("더보기", tabHeader = true) {
                    SettingsScreen(privateAccount, appearance, onSignIn = { open("talks") },
                        onProfile = if (privateAccount != null && services.profiles != null) ({ open("profile") }) else null,
                        onAccount = if (privateAccount != null) ({ open("account") }) else null,
                        onAppearance = { open("appearance") }, onNotifications = { open("notifications") }, onAbout = { open("about") },
                        onBlocks = if (session.access == ShellAccess.READY && services.blocks != null && session.accountPartition != null) ({ open("blocks") }) else null,
                        accessSection = { if (privateAccount != null && services.access != null) AccountAccessSettings(services.access, renderedIdentity, operation.busy, sessionModel::password) },
                        profileModel = profileModel, avatar = { profile ->
                            if (session.access == ShellAccess.READY && services.accountMedia != null && session.accountPartition != null)
                                chat.rogi.rogichat.feature.media.AccountProfileAvatar(services.accountMedia, renderedIdentity, profile.avatarAssetId)
                            else Text("사진을 확인할 수 없어요", style = MaterialTheme.typography.bodySmall)
                        })
                }
            }
            composable("blocks") {
                if (session.access == ShellAccess.READY && privateAccount != null && services.blocks != null && session.accountPartition != null) {
                    val model: chat.rogi.rogichat.feature.messageactions.AccountBlocksModel = viewModel { chat.rogi.rogichat.feature.messageactions.AccountBlocksModel(services.blocks, renderedIdentity) }
                    chat.rogi.rogichat.feature.messageactions.AccountBlocksScreen(model) { nav.popBackStack() }
                }
            }
            composable("appearance") { ProductPage("화면 모드", { nav.popBackStack() }) { AppearanceScreen(appearance, onAppearance) } }
            composable("notifications") {
                val repository = services.notificationPreferences
                val model: NotificationSettingsViewModel? = if (privateAccount != null && repository != null)
                    viewModel { NotificationSettingsViewModel(repository, NotificationAccountScope(privateAccount.id, session.generation)) } else null
                ProductPage("알림 설정", { nav.popBackStack() }) { NotificationSettingsScreen(model, services.push, privateAccount?.takeIf { session.access == ShellAccess.READY }?.let { NotificationAccountScope(it.id, session.generation) }) }
            }
            composable("about") { ProductPage("로기챗 정보", { nav.popBackStack() }) { AboutScreen { open("licenses") } } }
            composable("licenses") { ProductPage("오픈소스 라이선스", { nav.popBackStack() }) { LicensesScreen() } }
            composable("profile") {
                if (privateAccount != null && services.profiles != null) {
                    val model: ProfileViewModel = viewModel { ProfileViewModel(services.profiles, privateAccount.id) }
                    val profileState by model.uiState.collectAsStateWithLifecycle()
                    val avatar: chat.rogi.rogichat.feature.media.AvatarSettingsModel? = if (profileState.original != null && session.access == ShellAccess.READY && services.accountMedia != null && session.accountPartition != null)
                        viewModel { chat.rogi.rogichat.feature.media.AvatarSettingsModel(services.accountMedia, renderedIdentity, profileState.original?.avatarAssetId, profileState.original?.providerAvatarUrl != null) } else null
                    ProfileScreen(model, avatar) { nav.popBackStack() }
                } else LaunchedEffect(Unit) { nav.popBackStack() }
            }
            composable("account") {
                if (privateAccount != null) ProductPage("계정 관리", { nav.popBackStack() }) {
                    AccountScreen(privateAccount, operation.busy,
                        if (services.actions?.canSignOut == true) ({ sessionModel.signOut(renderedIdentity) }) else null,
                        if (services.deletion != null && !deletionState.blocksSession) sessionModel::deleteAccount else null,
                        if (!privateAccount.soopConnected && !operation.busy && services.actions?.canLinkSoop == true) sessionModel::linkSoop else null,
                        session.generation)
                } else LaunchedEffect(Unit) { nav.popBackStack() }
            }
            composable("room/{roomId}") { backStack ->
                val selected = conversationNavigation.selected
                val repository = services.conversations
                if (session.access == ShellAccess.READY && selected != null && repository != null &&
                    selected.account.localEpoch == session.generation && selected.account.accountId == privateAccount?.id &&
                    selected.membership.roomId.value == backStack.arguments?.getString("roomId")) {
                    val model: ConversationViewModel = viewModel(key = "conversation-${selected.directoryCycle.value}-${selected.membership.roomId.value}") {
                        ConversationViewModel(repository, selected, navigation = conversationNavigation)
                    }
                    val roomsOwner = remember(backStack) { nav.getBackStackEntry("talks") }
                    val roomsModel: RoomsViewModel = viewModel(viewModelStoreOwner = roomsOwner) {
                        RoomsViewModel(requireNotNull(services.rooms), selected.account)
                    }
                    var menuOpen by remember(selected) { mutableStateOf(false) }
                    var confirmLeave by remember(selected) { mutableStateOf(false) }
                    var leaveError by remember(selected) { mutableStateOf<String?>(null) }
                    var leaving by remember(selected) { mutableStateOf(false) }
                    val actionScope = rememberCoroutineScope()
                    if (confirmLeave) AlertDialog(
                        onDismissRequest = { confirmLeave = false },
                        title = { Text("대화에서 나갈까요?") },
                        text = { Text("나가도 보낸 메시지는 삭제되지 않아요.") },
                        confirmButton = { TextButton(onClick = {
                            confirmLeave = false
                            leaving = true
                            actionScope.launch {
                                val error = roomsModel.leaveConversation(selected)
                                leaving = false
                                if (error == null) nav.popBackStack() else leaveError = error
                            }
                        }) { Text("나가기", color = MaterialTheme.colorScheme.error) } },
                        dismissButton = { TextButton(onClick = { confirmLeave = false }) { Text("취소") } },
                    )
                    leaveError?.let { error -> AlertDialog(onDismissRequest = { leaveError = null },
                        title = { Text("대화에서 나가지 못했어요") }, text = { Text(error) },
                        confirmButton = { TextButton(onClick = { leaveError = null }) { Text("확인") } }) }
                    ProductPage(selected.membership.name, { nav.popBackStack() }, scroll = false,
                        actions = {
                            Box {
                                IconButton(onClick = { menuOpen = true }, enabled = !leaving) {
                                    Text("⋮", style = MaterialTheme.typography.titleLarge)
                                }
                                DropdownMenu(expanded = menuOpen, onDismissRequest = { menuOpen = false }) {
                                    DropdownMenuItem(text = { Text("대화에서 나가기") }, onClick = {
                                        menuOpen = false
                                        confirmLeave = true
                                    })
                                }
                            }
                        }) { ConversationScreen(model) }
                } else if (session.access == ShellAccess.READY && roomContent != null) {
                    backStack.arguments?.getString("roomId")?.let { roomContent(it) { nav.popBackStack() } }
                } else LaunchedEffect(Unit) { nav.popBackStack() }
            }
        }
    }
}

@Composable
private fun ProductPage(title: String, onBack: (() -> Unit)? = null, scroll: Boolean = true,
                        showTopBar: Boolean = true,
                        tabHeader: Boolean = false,
                        actions: @Composable RowScope.() -> Unit = {},
                        content: @Composable ColumnScope.() -> Unit) {
    Column(Modifier.fillMaxSize()) {
        if (showTopBar) {
            if (tabHeader) AppTabHeader(title, actions) else AppTopBar(title, onBack, actions)
        }
        Column(Modifier.weight(1f).fillMaxWidth()
            .then(if (scroll) Modifier.verticalScroll(rememberScrollState()) else Modifier), content = content)
    }
}
