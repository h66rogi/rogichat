import SwiftUI
import RogichatRooms

struct ProductRootView: View {
    @State private var session: AppSession
    @State private var confirmLocalReset = false
    private let nativeEnvironment: NativeEnvironment
    @State private var navigation = ShellNavigation()
    @State private var roomsStorage: RoomsStorage
    @Environment(\.scenePhase) private var scenePhase

    init(service: (any SessionServing)? = nil) {
        let environment = NativeEnvironment(rawValue: AppEnvironment().name.rawValue)!
        nativeEnvironment = environment
        let api = NativeAPIClient(environment: environment)
        let store = NativeCredentialStore(environment: environment)
        let auth = SOOPAuthCoordinator(environment: environment, store: store, api: api, browser: SOOPBrowserSession())
        let directory = FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask)[0]
            .appendingPathComponent("rooms-" + environment.rawValue, isDirectory: true)
        let roomsStorage = RoomsStorage(root: directory)
        let native = service ?? NativeSessionService(environment: environment, api: api, store: store, auth: auth, purgeRooms: { try roomsStorage.purge() })
        _session = State(initialValue: AppSession(service: native))
        _roomsStorage = State(initialValue: roomsStorage)
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
        .onOpenURL { url in Task { await session.acceptAuthCallback(url) } }
        .onContinueUserActivity(NSUserActivityTypeBrowsingWeb) { activity in
            if let url = activity.webpageURL { Task { await session.acceptAuthCallback(url) } }
        }
        .confirmationDialog("이 기기의 로그인 정보를 지울까요?", isPresented: $confirmLocalReset, titleVisibility: .visible) {
            Button("로그인 정보 지우기", role: .destructive) { Task { await session.resetLocalSession() } }
            Button("취소", role: .cancel) {}
        } message: {
            Text("저장된 로그인 정보를 기기에서 삭제해 다시 로그인할 수 있게 합니다. 서버의 로그인 종료는 확인할 수 없어요.")
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
                await session.expire(expected: expiry)
            } catch { /* View cancellation does not change credentials. */ }
        }
        .onChange(of: session.generation) { _, _ in navigation.setAccess(session.access) }
        .onChange(of: session.access, initial: true) { _, access in navigation.setAccess(access) }
    }
    @ViewBuilder private func destination(_ page: AppPage) -> some View {
        switch page {
        case .welcome:
            WelcomeScreen(methods: session.capabilities.signInMethods, busy: session.busy, errorMessage: session.errorMessage,
                          rulesURL: nativeEnvironment.rulesURL, onCancel: { Task { await session.cancelAuthentication() } }) { method, consent in
                Task { await session.signIn(method, consent: consent) }
            }
        case .settings:
            SettingsScreen(account: session.account, capabilities: session.capabilities, onOpen: { navigation.open($0) }, onSignIn: { navigation.selectTab(.talks) })
        case .appearance: AppearanceScreen()
        case .notifications:
            let scope = session.generation
            NotificationSettingsScreen(accountScope: session.account == nil ? nil : scope,
                                       fetchPreferences: { try await session.loadNotificationPreferences(scope: scope) },
                                       disablePreferences: { try await session.disableAccountNotifications(expected: $0, scope: scope) })
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
                           onLink: { Task { await session.linkSOOP() } }, onAccount: { navigation.selectTab(.settings); navigation.open(.account) },
                           onCancel: { Task { await session.cancelAuthentication() } })
        case .rooms:
            if session.account != nil, session.access == .ready {
                if let scope = session.roomsScope {
                    RoomsScreen(repository: RoomsRepository(remote: NativeRoomsRemote(session: session), storage: roomsStorage, scope: scope), scope: scope)
                        .id(scope.clientScope)
                } else {
                    ContentUnavailableView("대화방을 확인할 수 없어요", systemImage: "bubble.left.and.bubble.right", description: Text("계정 정보를 다시 확인해 주세요."))
                        .safeAreaInset(edge: .bottom) { Button("다시 확인") { Task { await session.revalidate() } }.buttonStyle(.bordered).padding() }
                }
            }
        case .status:
            if session.access == .restoring {
                ScreenStatus(title: "로기챗", message: "계정 정보를 확인하고 있어요.", loading: true).frame(maxHeight: .infinity)
            } else if session.access == .retryableFailure {
                VStack(spacing: 16) {
                    ScreenStatus(title: "계정을 확인하지 못했어요", message: session.errorMessage ?? "연결을 확인하고 다시 시도해 주세요.", retry: { Task { await session.restore() } })
                    if session.account == nil, session.capabilities.canResetLocalSession {
                        Button("이 기기의 로그인 정보 지우기", role: .destructive) { confirmLocalReset = true }
                    }
                }.frame(maxHeight: .infinity)
            } else {
                ContentUnavailableView(session.access == .accountClosing ? "계정 탈퇴를 처리하고 있어요" : "계정을 이용할 수 없어요", systemImage: "person.crop.circle.badge.exclamationmark")
            }
        case .chat, .report:
            ContentUnavailableView("대화에 접근할 수 없어요", systemImage: "lock")
        }
    }
}
