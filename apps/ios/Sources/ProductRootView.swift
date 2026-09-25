import SwiftUI
import RogichatRooms

struct ProductRootView: View {
    @StateObject private var realtime = NativeRealtimeManager(factory: SocketIORealtimeFactory())
    @State private var reconcilingWake = false
    @State private var session: AppSession
    @State private var confirmLocalReset = false
    @State private var resetGeneration: UInt64?
    @State private var resetAfterHistoryDismiss = false
    private let nativeEnvironment: NativeEnvironment
    @State private var navigation = ShellNavigation()
    @State private var roomsStorage: RoomsStorage
    @State private var roomsFeatures = RoomsFeatureOwner()
    @Environment(\.scenePhase) private var scenePhase

    init(service: (any SessionServing)? = nil) {
        let environment = NativeEnvironment(rawValue: AppEnvironment().name.rawValue)!
        nativeEnvironment = environment
        let api = NativeAPIClient(environment: environment)
        let store = NativeCredentialStore(environment: environment)
        let soop = SOOPAuthCoordinator(environment: environment, store: store, api: api, browser: SOOPBrowserSession())
        let apple = AppleIdentityCoordinator(environment: environment, store: store, api: api, revoker: api, provider: NativeApplePresentation())
        let auth = NativeIdentityRouter(soop: soop, apple: apple)
        let directory = FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask)[0]
            .appendingPathComponent("rooms-" + environment.rawValue, isDirectory: true)
        let roomsStorage = RoomsStorage(root: directory)
        let native = service ?? NativeSessionService(environment: environment, api: api, store: store, auth: auth, appleEnabled: true, purgeRooms: { try roomsStorage.purge() })
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
        .sheet(isPresented: $session.showDeletionHistory, onDismiss: {
            if resetAfterHistoryDismiss { resetAfterHistoryDismiss = false; confirmLocalReset = true }
        }) {
            AccountDeletionScreen(records: session.visibleDeletions, busy: session.busy, error: session.deletionError,
                onRetry: { id in Task { await session.retryDeletionCleanup(id: id) } },
                onReset: { resetGeneration = session.generation; resetAfterHistoryDismiss = true; session.showDeletionHistory = false },
                onDismiss: { session.dismissDeletionPresentation() })
        }
        .confirmationDialog("이 기기의 정보를 지울까요?", isPresented: $confirmLocalReset, titleVisibility: .visible) {
            Button("기기 정보 지우기", role: .destructive) {
                if let expected = resetGeneration { Task { await session.resetLocalSession(expectedGeneration: expected) } }
            }
            Button("취소", role: .cancel) {}
        } message: {
            Text("이 기기의 로그인 정보와 탈퇴 요청 내역이 지워져요. 이미 신청한 탈퇴는 취소되지 않아요.")
        }
        .task {
            session.scopeInvalidated = { realtime.disconnect() }
            NativePushWakeOwner.shared.wake = {
                await session.revalidate()
                guard session.access == .ready, session.account != nil else { return false }
                if let model = roomsFeatures.conversation, model.active { await model.refresh(); return model.error == nil }
                await roomsFeatures.refreshCurrent(); return true
            }
            await session.restore()
        }
        .onChange(of: scenePhase) { _, phase in
            if phase == .active { Task { await session.revalidate(); await connectRealtime() } }
            else { realtime.disconnect() }
        }
        .task(id: session.generation) { await connectRealtime() }
        .onReceive(realtime.events) { event in
            guard !reconcilingWake, scenePhase == .active else { return }
            reconcilingWake = true
            let ticket = session.generation
            Task {
                defer { reconcilingWake = false }
                await session.revalidate()
                guard ticket == session.generation, session.access == .ready, scenePhase == .active else { return }
                switch event {
                case .syncRequired(let scope):
                    guard let offer = try? await session.realtimeOffer(), offer.scope == scope, ticket == session.generation else { return }
                    if let model = roomsFeatures.conversation, model.active { await model.refresh() }
                    else { await roomsFeatures.refreshCurrent() }
                case .revalidationRequired(let old):
                    do {
                        try await Task.sleep(for: .seconds(2))
                        let offer = try await session.realtimeOffer()
                        guard ticket == session.generation, offer.scope == old.scope, scenePhase == .active else { return }
                        realtime.reconnect(ticket: old, bearer: offer.bearer)
                    } catch { /* REST periodic/foreground reconciliation remains active. */ }
                }
            }
        }
        .task(id: session.expiresAt) {
            guard let expiry = session.expiresAt else { return }
            do {
                try await Task.sleep(for: .seconds(max(0, expiry.timeIntervalSinceNow)))
                guard !Task.isCancelled else { return }
                await session.expire(expected: expiry)
            } catch { /* View cancellation does not change credentials. */ }
        }
        .onChange(of: session.roomsScope?.clientScope) { _, value in if value == nil { roomsFeatures.clear() } }
        .onChange(of: session.generation) { _, _ in navigation.setAccess(session.access) }
        .onChange(of: session.access, initial: true) { _, access in navigation.setAccess(access) }
    }
    private func connectRealtime() async {
        guard scenePhase == .active, session.access == .ready else { realtime.disconnect(); return }
        do {
            let offer = try await session.realtimeOffer()
            guard scenePhase == .active, session.access == .ready else { return }
            realtime.bind(scope: offer.scope, foreground: true)
            if realtime.connectionStatus == .disconnected || realtime.connectionStatus == .revalidationRequired {
                realtime.connect(scope: offer.scope, bearer: offer.bearer)
            }
        } catch { realtime.disconnect() }
    }
    @ViewBuilder private func destination(_ page: AppPage) -> some View {
        switch page {
        case .welcome:
            WelcomeScreen(methods: session.capabilities.signInMethods, busy: session.busy, errorMessage: session.errorMessage,
                          rulesURL: nativeEnvironment.rulesURL, onCancel: { Task { await session.cancelAuthentication() } }, onSignIn: { method, consent in
                Task { await session.signIn(method, consent: consent) }
            }, onPassword: session.capabilities.canPassword ? { input, consent in Task { await session.password(input,consent:consent) } } : nil)
        case .settings:
            MoreView(accessSession: session, account: session.account, capabilities: session.capabilities, onOpen: { navigation.open($0) }, onSignIn: { navigation.selectTab(.talks) }, rulesURL: nativeEnvironment.rulesURL, onSignOut: session.capabilities.canSignOut ? { try await session.signOut() } : nil, canManageBlocks: session.roomsScope != nil, hasDeletionHistory: session.account == nil && !session.deletions.isEmpty, onDeletionHistory: { session.showDeletionHistory = true },
                onLoadProfile: { try await session.loadProfile() }, avatar: { profile in
                    guard let scope = session.roomsScope else { return AnyView(Text("사진을 확인할 수 없어요").font(.caption)) }
                    let client = MediaClient(transport: AccountMediaTransport(session: session, original: scope), scope: AccountMediaScope(original: scope), apiBaseURL: nativeEnvironment.baseURL)
                    if let asset = profile.avatarAssetID { return AnyView(AuthorizedMedia(client: client, assetID: asset, access: .preview(.image), avatar: true)) }
                    return AnyView(AuthorizedProviderAvatar(client: client))
                }).id(session.generation)
        case .appearance: AppearanceScreen()
        case .notifications:
            let scope = session.generation
            NotificationSettingsScreen(accountScope: session.account == nil ? nil : scope, session: session,
                                       fetchPreferences: { try await session.loadNotificationPreferences(scope: scope) },
                                       disablePreferences: { try await session.disableAccountNotifications(expected: $0, scope: scope) })
        case .licenses: OpenSourceLicensesScreen()
        case .profile:
            if session.account != nil, session.capabilities.canEditProfile {
                ProfileLoader(onLoad: { try await session.loadProfile() }, onSave: { try await session.saveProfile($0) }, avatar: { profile in
                    guard let scope = session.roomsScope else { return nil }
                    return AnyView(AccountAvatarSection(session: session, storage: roomsStorage, scope: scope, accountID: profile.id, originalAssetID: profile.avatarAssetID, apiBaseURL: nativeEnvironment.baseURL, originalProviderAvatarAvailable: profile.providerAvatarURL != nil))
                })
                    .id(session.generation)
            }
        case .account:
            if let account = session.account {
                let generation = session.generation
                AccountScreen(account: account, capabilities: session.capabilities,
                              onLink: { navigation.selectTab(.talks) }, onLinkApple: { Task { await session.linkApple() } }, prepareDeletion: { session.deletionIntent(expectedGeneration: generation) }, onDelete: { session.startDeletion($0) })
                    .id(session.generation)
            }
        case .link:
            SOOPLinkScreen(busy: session.busy, canLink: session.capabilities.canLinkSOOP, errorMessage: session.errorMessage,
                           onLink: { Task { await session.linkSOOP() } }, onAccount: { navigation.selectTab(.settings); navigation.open(.account) },
                           onCancel: { Task { await session.cancelAuthentication() } })
        case .rooms:
            if session.account != nil, session.access == .ready {
                if let scope = session.roomsScope {
                    RoomsScreen(model: roomsFeatures.model(scope: scope) {
                        RoomsScreenModel(repository: RoomsRepository(remote: NativeRoomsRemote(session: session), storage: roomsStorage, scope: scope), scope: scope)
                    }, onOpenConversation: { navigation.open(.chat) })
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
                        Button("이 기기의 정보 초기화", role: .destructive) { resetGeneration = session.generation; confirmLocalReset = true }
                    }
                }.frame(maxHeight: .infinity)
            } else if session.access == .accountClosing {
                ScreenStatus(title: "탈퇴 진행 중", message: "잠시만 기다려 주세요.", loading: true)
                    .safeAreaInset(edge: .bottom) { Button("요청 상태 보기") { session.showDeletionHistory = true }.padding() }
            } else {
                ContentUnavailableView(session.access == .accountClosing ? "계정 탈퇴를 처리하고 있어요" : "계정을 이용할 수 없어요", systemImage: "person.crop.circle.badge.exclamationmark")
            }
        case .chat:
            if let model = roomsFeatures.conversation, session.roomsScope === model.scope.account {
                ConversationScreen(model: model, session: session, environment: nativeEnvironment.rawValue, accountID: session.account!.id, onReopen: {
                    roomsFeatures.closeConversation()
                    navigation.pop(to: [], in: .talks)
                }).id(model.scope.cacheID)
            } else { ContentUnavailableView("대화에 접근할 수 없어요", systemImage: "lock") }
        case .report:
            if let scope = session.roomsScope, let account = session.account {
                OwnBlocksScreen(session: session, storage: roomsStorage, scope: scope, accountID: account.id, environment: nativeEnvironment.rawValue,
                    onAuthorityChanged: { roomsFeatures.closeConversation(); Task { await roomsFeatures.refreshCurrent() } }).id(scope.clientScope)
            } else { ContentUnavailableView("계정 상태를 확인해 주세요", systemImage: "lock") }
        }
    }
}
