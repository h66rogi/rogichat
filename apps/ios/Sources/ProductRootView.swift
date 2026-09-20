import SwiftUI

struct ProductRootView: View {
    @State private var session: AppSession
    @State private var navigation = ShellNavigation()
    private let rooms: any RoomsServing
    @Environment(\.scenePhase) private var scenePhase

    init(service: (any SessionServing)? = nil, rooms: any RoomsServing = UnavailableRoomsService()) {
        let environment = NativeEnvironment(rawValue: AppEnvironment().name.rawValue)!
        let native = service ?? NativeSessionService(environment: environment, api: NativeAPIClient(environment: environment),
                                                     store: NativeCredentialStore(environment: environment))
        _session = State(initialValue: AppSession(service: native))
        self.rooms = rooms
    }
    var body: some View {
        AppShell(navigation: navigation, onTab: { navigation.selectTab($0) }, onPop: { navigation.pop(to: $0, in: $1) }) { page in
            destination(page)
        }
        .safeAreaInset(edge: .top) {
            if session.account != nil, let error = session.errorMessage {
                HStack(spacing: 12) {
                    Text(error).font(.footnote).frame(maxWidth: .infinity, alignment: .leading)
                    Button { Task { await session.revalidate() } } label: {
                        if session.revalidating { ProgressView().accessibilityLabel("계정을 확인하는 중") }
                        else { Text("다시 시도").font(.footnote.bold()) }
                    }.disabled(session.revalidating)
                }
                .padding().background(.regularMaterial)
            }
        }
        .task { await session.restore() }
        .onChange(of: scenePhase) { _, phase in
            if phase == .active { Task { await session.revalidate() } }
        }
        .task(id: session.expiresAt) {
            guard let expiry = session.expiresAt else { return }
            do {
                try await Task.sleep(for: .seconds(max(0, expiry.timeIntervalSinceNow)))
                guard !Task.isCancelled else { return }
                await session.restore()
            } catch { /* View cancellation does not change credentials. */ }
        }
        .onChange(of: session.generation) { _, _ in navigation.setAccess(session.access) }
        .onChange(of: session.access, initial: true) { _, access in navigation.setAccess(access) }
    }
    @ViewBuilder private func destination(_ page: AppPage) -> some View {
        switch page {
        case .welcome:
            WelcomeScreen(methods: session.capabilities.signInMethods, busy: session.busy, errorMessage: session.errorMessage) { method in
                Task { await session.signIn(method) }
            }
        case .settings:
            SettingsScreen(account: session.account, capabilities: session.capabilities, onOpen: { navigation.open($0) }, onSignIn: { navigation.selectTab(.talks) })
        case .appearance: AppearanceScreen()
        case .notifications: NotificationSettingsScreen()
        case .about: AboutScreen()
        case .profile:
            if session.account != nil, session.capabilities.canEditProfile {
                ProfileLoader(onLoad: { try await session.loadProfile() }, onSave: { try await session.saveProfile($0) })
                    .id(session.generation)
            }
        case .account:
            if let account = session.account {
                AccountScreen(account: account, capabilities: session.capabilities,
                              onLink: { navigation.selectTab(.talks) }, onSignOut: { try await session.signOut() }, onDelete: { try await session.deleteAccount() })
                    .id(session.generation)
            }
        case .link:
            SOOPLinkScreen(busy: session.busy, canLink: session.capabilities.canLinkSOOP, errorMessage: session.errorMessage,
                           onLink: { Task { await session.linkSOOP() } }, onAccount: { navigation.selectTab(.settings); navigation.open(.account) })
        case .rooms:
            // Room entry is intentionally not exposed until a real chat coordinator is installed.
            // This screen is reachable only from an authenticated, SOOP-linked session service.
            if let account = session.account, session.access == .ready {
                RoomsScreen(accountID: account.id, service: rooms, onOpen: nil).id(session.generation)
            }
        case .status:
            if session.access == .restoring {
                ScreenStatus(title: "로기챗", message: "계정 정보를 확인하고 있어요.", loading: true).frame(maxHeight: .infinity)
            } else if session.access == .retryableFailure {
                ScreenStatus(title: "계정을 확인하지 못했어요", message: session.errorMessage ?? "연결을 확인하고 다시 시도해 주세요.", retry: { Task { await session.restore() } }).frame(maxHeight: .infinity)
            } else {
                ContentUnavailableView(session.access == .accountClosing ? "계정 탈퇴를 처리하고 있어요" : "계정을 이용할 수 없어요", systemImage: "person.crop.circle.badge.exclamationmark")
            }
        case .chat, .report:
            ContentUnavailableView("대화에 접근할 수 없어요", systemImage: "lock")
        }
    }
}
