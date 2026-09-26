import SwiftUI

// Copied and adapted from meloming-ios d133fb4,
// Meloming/Presentation/More/MoreView.swift (build 26 / iOS 1.2.3).
// AppShell owns NavigationStack; authentication and destinations use Rogichat's live session.
struct MoreView: View {
    var accessSession: AppSession? = nil
    let environment: NativeEnvironment
    let account: AccountSummary?
    let capabilities: SessionCapabilities
    let onOpen: (AppPage) -> Void
    let onSignIn: () -> Void
    let rulesURL: URL
    var onSignOut: (() async throws -> Void)?
    var canManageBlocks = false
    var hasDeletionHistory = false
    var onDeletionHistory: () -> Void = {}
    var onLoadProfile: (() async throws -> AccountProfile)?
    var avatar: (AccountProfile) -> AnyView? = { _ in nil }
    @State private var showLogoutAlert = false
    @State private var profile: AccountProfile?
    @State private var profileError: String?
    @State private var profileRetry = 0
    @State private var loadedProfileKey: [String]?
    @State private var signingOut = false
    @State private var signOutError: String?
    @State private var versionTapCount = 0
    @State private var lastVersionTapTime: Date?
    @State private var showDeveloperTools = false
    @Environment(\.openURL) private var openURL

    private var appVersion: String {
        let version = Bundle.main.infoDictionary?["CFBundleShortVersionString"] as? String ?? "1.0.0"
        let build = Bundle.main.infoDictionary?["CFBundleVersion"] as? String ?? "1"
        return "\(version) (\(build))"
    }

    private var canOpenAccount: Bool {
        accessSession?.access == .ready || accessSession?.access == .linkRequired
    }

    private var profileLoadKey: [String] {
        [account?.id ?? "", account?.displayName ?? "", account?.avatarAssetID ?? "", String(profileRetry)]
    }

    var body: some View {
        moreListView
    }

    @ViewBuilder
    private var moreListView: some View {
        VStack(spacing: 0) {
            TopLevelTabHeader(title: "더보기") {
                NotificationButton { onOpen(.notifications) }
                    .accessibilityLabel("알림")
            }
            List { listSections }
        }
        .toolbar(.hidden, for: .navigationBar)
        .alert("로그아웃", isPresented: $showLogoutAlert) {
                Button("취소", role: .cancel) {}
                Button("로그아웃", role: .destructive) {
                    guard let onSignOut else { return }
                    signingOut = true
                    signOutError = nil
                    Task { @MainActor in
                        defer { signingOut = false }
                        do { try await onSignOut() }
                        catch { signOutError = "로그아웃을 완료하지 못했어요. 다시 시도해 주세요." }
                    }
                }
            } message: {
                Text("이 기기에서 로기챗 계정이 로그아웃됩니다.")
            }
            .sheet(isPresented: $showDeveloperTools) {
                NavigationStack {
                    DeveloperToolsView(environment: environment, session: accessSession)
                        .toolbar {
                            ToolbarItem(placement: .cancellationAction) {
                                Button("닫기") { showDeveloperTools = false }
                            }
                        }
                }
            }
            .task(id: profileLoadKey) {
                let key = profileLoadKey
                guard let account else {
                    profile = nil
                    profileError = nil
                    loadedProfileKey = nil
                    return
                }
                guard loadedProfileKey != key else { return }
                if profile?.id != account.id { profile = nil }
                profileError = nil
                guard let onLoadProfile else { return }
                do {
                    let value = try await onLoadProfile()
                    try Task.checkCancellation()
                    guard value.id == account.id else { throw ProductError.sessionChanged }
                    profile = value
                    loadedProfileKey = key
                } catch {
                    if !Task.isCancelled {
                        loadedProfileKey = key
                        profileError = (error as? ProductError)?.errorDescription ?? "프로필을 불러오지 못했어요. 다시 시도해 주세요."
                    }
                }
            }
    }

    @ViewBuilder
    private var listSections: some View {
        // Profile Section or Login Prompt
        if let account {
            Section {
                if canOpenAccount {
                    Button { onOpen(capabilities.canEditProfile ? .profile : .account) } label: {
                        signedInProfileRow(account: account)
                    }
                    .buttonStyle(.plain)
                } else {
                    signedInProfileRow(account: account)
                }
                if let profileError {
                    Button("프로필 다시 불러오기") { profileRetry += 1 }
                    Text(profileError).font(.footnote).foregroundStyle(.secondary)
                }
            }
        } else {
            Section {
                Button(action: onSignIn) {
                    HStack(spacing: 16) {
                        Circle()
                            .fill(Color.accentColor.opacity(0.2))
                            .frame(width: 60, height: 60)
                            .overlay(
                                Image(systemName: "person.fill")
                                    .font(.title2)
                                    .foregroundColor(.accentColor)
                            )

                        VStack(alignment: .leading, spacing: 4) {
                            Text("로그인")
                                .font(.headline)
                                .foregroundColor(.primary)

                            Text("로그인하여 더 많은 기능을 이용하세요")
                                .font(.subheadline)
                                .foregroundColor(.secondary)
                        }

                        Spacer()

                        Image(systemName: "chevron.right")
                            .foregroundColor(.secondary)
                    }
                    .padding(.vertical, 2)
                    .contentShape(Rectangle())
                }
                .buttonStyle(.plain)
            }
        }

        // Account Section (only for logged-in users)
        if account != nil, canOpenAccount {
            Section("설정") {
                Button { onOpen(.notificationSettings) } label: { Label("알림 설정", systemImage: "bell.badge") }
                if capabilities.canEditProfile {
                    Button { onOpen(.profile) } label: {
                        Label("프로필 설정", systemImage: "person.circle")
                    }
                }
                Button { onOpen(.account) } label: {
                    Label("계정 관리", systemImage: "lock.shield")
                }
                if canManageBlocks {
                    Button { onOpen(.report) } label: {
                        Label("차단 관리", systemImage: "person.crop.circle.badge.minus")
                    }
                }
            }
        }

        // App Section
        Section("앱 정보") {
            Button {
                openURL(rulesURL)
            } label: {
                Label("이용 안내", systemImage: "doc.text")
            }

            HStack {
                Label("버전", systemImage: "info.circle")
                Spacer()
                Text(appVersion)
                    .foregroundColor(.secondary)
            }
            .contentShape(Rectangle())
            .onTapGesture { handleVersionTap() }

            Button { onOpen(.licenses) } label: {
                HStack {
                    Label("오픈소스 라이선스", systemImage: "doc.plaintext")
                    Spacer()
                    Image(systemName: "chevron.right")
                        .font(.caption)
                        .foregroundColor(.secondary)
                }
            }
        }

        if hasDeletionHistory {
            Section("기기 기록") {
                Button("탈퇴 요청 기록", systemImage: "doc.text", action: onDeletionHistory)
            }
        }

        // Logout Section (only for logged-in users)
        if account != nil, onSignOut != nil {
            Section {
                Button(role: .destructive) {
                    showLogoutAlert = true
                } label: {
                    Label("로그아웃", systemImage: "rectangle.portrait.and.arrow.right")
                        .foregroundColor(.red)
                }
                .disabled(signingOut)
                if signingOut { ProgressView("로그아웃하는 중") }
                if let signOutError { Text(signOutError).font(.footnote).foregroundStyle(.red) }
            }
        }
    }

    private func signedInProfileRow(account: AccountSummary) -> some View {
        HStack(spacing: 16) {
            Group {
                if let profile, profile.id == account.id, profile.avatarAssetID == account.avatarAssetID,
                   (profile.avatarAssetID != nil || profile.providerAvatarURL != nil), let photo = avatar(profile) { photo }
                else {
                    Circle()
                        .fill(Color.accentColor.opacity(0.2))
                        .overlay(
                            Image(systemName: "person.fill")
                                .font(.title2)
                                .foregroundColor(.accentColor)
                        )
                }
            }
            .frame(width: 60, height: 60)
            .clipShape(Circle())

            VStack(alignment: .leading, spacing: 4) {
                Text(account.displayName)
                    .font(.headline)
                Text(account.soopConnected ? "SOOP 계정 연결됨" : "SOOP 계정 연결 필요")
                    .font(.subheadline)
                    .foregroundColor(.secondary)
            }

            Spacer()

            if canOpenAccount {
                Image(systemName: "chevron.right")
                    .foregroundColor(.secondary)
            }
        }
        .padding(.vertical, 2)
        .contentShape(Rectangle())
    }

    // Copied from meloming-ios d133fb4 MoreView.handleVersionTap().
    private func handleVersionTap() {
        let now = Date()
        if let lastTap = lastVersionTapTime, now.timeIntervalSince(lastTap) > 2.0 {
            versionTapCount = 0
        }
        lastVersionTapTime = now
        versionTapCount += 1

        if versionTapCount >= 7 {
            versionTapCount = 0
            showDeveloperTools = true
        }
    }
}
