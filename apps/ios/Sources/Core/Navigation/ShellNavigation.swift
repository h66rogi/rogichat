// Product access is supplied by AppSession. Synthetic state exists only in tests.
enum ShellAccess: String, CaseIterable, Sendable {
    case signedOut = "미로그인", linkRequired = "SOOP 연결 필요", ready = "이용 가능"
    case restoring = "복원 중", retryableFailure = "연결 오류", blocked = "이용 제한", accountClosing = "계정 종료 중"
}
enum AppTab: String, CaseIterable, Sendable { case talks = "대화", settings = "설정" }
enum AppPage: String, Hashable, Sendable {
    case welcome = "로기챗", link = "SOOP 계정 연결", rooms = "대화", chat = "대화방", settings = "설정"
    case profile = "내 프로필", account = "계정 관리", report = "신고 및 차단"
    case notifications = "알림 설정", about = "로기챗 정보", appearance = "화면 모드", status = "이용 상태"
}
struct ShellNavigation: Sendable {
    private(set) var access: ShellAccess = .signedOut
    private(set) var tab: AppTab = .talks
    private(set) var talkPath: [AppPage] = []
    private(set) var settingsPath: [AppPage] = []
    var canManageAccount: Bool { access == .linkRequired || access == .ready }
    func root(for value: AppTab) -> AppPage {
        if value == .settings { return .settings }
        switch access {
        case .signedOut: return .welcome
        case .linkRequired: return .link
        case .ready: return .rooms
        default: return .status
        }
    }
    func path(for value: AppTab) -> [AppPage] { value == .talks ? talkPath : settingsPath }
    var page: AppPage { path(for: tab).last ?? root(for: tab) }
    mutating func setAccess(_ value: ShellAccess) { self = ShellNavigation(access: value) }
    mutating func selectTab(_ value: AppTab) { tab = value }
    mutating func open(_ value: AppPage) {
        if value == .settings { tab = .settings; return }
        let allowed: Bool
        switch value {
        case .chat: allowed = page == .rooms && access == .ready
        case .report: allowed = page == .chat && access == .ready
        case .profile: allowed = page == .settings && canManageAccount
        case .account: allowed = page == .settings && canManageAccount
        case .notifications, .about, .appearance: allowed = page == .settings
        default: allowed = false
        }
        guard allowed else { return }
        if tab == .talks { talkPath.append(value) } else { settingsPath.append(value) }
    }
    mutating func pop(to newPath: [AppPage], in value: AppTab) {
        let old = path(for: value)
        guard newPath.count < old.count, Array(old.prefix(newPath.count)) == newPath else { return }
        if value == .talks { talkPath = newPath } else { settingsPath = newPath }
    }
}
