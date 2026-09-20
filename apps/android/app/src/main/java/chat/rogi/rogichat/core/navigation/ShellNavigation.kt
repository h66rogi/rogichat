package chat.rogi.rogichat.core.navigation

// Presentation input only; the future SessionManager must supply real access state.
enum class ShellAccess(val label: String) {
    SIGNED_OUT("미로그인"), LINK_REQUIRED("SOOP 연결 필요"), READY("이용 가능"),
    RESTORING("복원 중"), RETRYABLE_FAILURE("연결 오류"), BLOCKED("이용 제한"), ACCOUNT_CLOSING("계정 종료 중")
}
enum class AppTab(val label: String) { TALKS("대화"), SETTINGS("설정") }
enum class AppPage(val title: String) {
    WELCOME("로기챗"), LINK("SOOP 계정 연결"), ROOMS("대화"), CHAT("대화방"),
    SETTINGS("설정"), PROFILE("내 프로필"), ACCOUNT("계정 관리"), REPORT("신고 및 차단"),
    NOTIFICATIONS("알림 설정"), ABOUT("앱 정보 및 지원"), STATUS("이용 상태")
}

data class ShellNavigation(
    val access: ShellAccess = ShellAccess.SIGNED_OUT,
    val tab: AppTab = AppTab.TALKS,
    val talkPath: List<AppPage> = emptyList(),
    val settingsPath: List<AppPage> = emptyList(),
) {
    val root: AppPage get() = if (tab == AppTab.SETTINGS) AppPage.SETTINGS else when (access) {
        ShellAccess.SIGNED_OUT -> AppPage.WELCOME
        ShellAccess.LINK_REQUIRED -> AppPage.LINK
        ShellAccess.READY -> AppPage.ROOMS
        else -> AppPage.STATUS
    }
    val path: List<AppPage> get() = if (tab == AppTab.TALKS) talkPath else settingsPath
    val page: AppPage get() = path.lastOrNull() ?: root
    val canGoBack: Boolean get() = path.isNotEmpty() || tab == AppTab.SETTINGS
    val canManageAccount: Boolean get() = access == ShellAccess.LINK_REQUIRED || access == ShellAccess.READY
    fun withAccess(value: ShellAccess) = ShellNavigation(access = value)
    fun selectTab(value: AppTab) = copy(tab = value)
    fun open(value: AppPage): ShellNavigation {
        if (value == AppPage.SETTINGS) return selectTab(AppTab.SETTINGS)
        val allowed = when (value) {
            AppPage.CHAT -> page == AppPage.ROOMS && access == ShellAccess.READY
            AppPage.REPORT -> page == AppPage.CHAT && access == ShellAccess.READY
            AppPage.PROFILE -> page == AppPage.SETTINGS && access == ShellAccess.READY
            AppPage.ACCOUNT -> page == AppPage.SETTINGS && canManageAccount
            AppPage.NOTIFICATIONS, AppPage.ABOUT -> page == AppPage.SETTINGS
            else -> false
        }
        if (!allowed) return this
        return if (tab == AppTab.TALKS) copy(talkPath = talkPath + value) else copy(settingsPath = settingsPath + value)
    }
    fun back(): ShellNavigation = when {
        path.isNotEmpty() && tab == AppTab.TALKS -> copy(talkPath = talkPath.dropLast(1))
        path.isNotEmpty() -> copy(settingsPath = settingsPath.dropLast(1))
        tab == AppTab.SETTINGS -> selectTab(AppTab.TALKS)
        else -> this
    }
}
