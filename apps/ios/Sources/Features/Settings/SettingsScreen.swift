import SwiftUI

// Adapted the complete profile-first MyPageView hub: hero, grouped actions,
// session gating and independent settings navigation. Unrelated commerce is omitted.
struct SettingsScreen: View {
    let account: AccountSummary?
    let capabilities: SessionCapabilities
    let onOpen: (AppPage) -> Void
    let onSignIn: () -> Void
    var canManageBlocks = false
    var hasDeletionHistory = false
    var onDeletionHistory: () -> Void = {}
    var onLoadProfile: (() async throws -> AccountProfile)?
    var avatar: (AccountProfile) -> AnyView? = { _ in nil }
    @State private var profile: AccountProfile?
    @State private var loadingProfile = false
    @State private var profileError: String?
    @State private var profileRetry = 0
    @AppStorage("appearance") private var appearance = AppAppearance.system.rawValue

    var body: some View {
        ScrollView {
            LazyVStack(alignment: .leading, spacing: 28) {
                profileHero
                if loadingProfile { ProgressView("프로필을 불러오는 중") }
                if let profileError {
                    VStack(alignment: .leading, spacing: 8) {
                        Text(profileError).font(.footnote).foregroundStyle(.secondary)
                        Button("프로필 다시 불러오기") { profileRetry += 1 }
                    }
                }
                if account != nil {
                    SettingsSection(title: "내 계정") {
                        if capabilities.canEditProfile {
                            SettingsRow(icon: "person.crop.circle", title: "프로필 수정", subtitle: "표시 이름과 생일 공개 설정", tint: .mint) { onOpen(.profile) }
                            Divider().padding(.leading, 65)
                        }
                        SettingsRow(icon: "lock.shield", title: "계정 관리", subtitle: "SOOP 연결과 로그인 계정", tint: .indigo) { onOpen(.account) }
                        if canManageBlocks {
                            Divider().padding(.leading, 65)
                            SettingsRow(icon: "person.crop.circle.badge.minus", title: "차단 관리", subtitle: "차단된 사용자 확인 및 해제", tint: .orange) { onOpen(.report) }
                        }
                    }
                }
                SettingsSection(title: "앱 설정") {
                    SettingsRow(icon: "bell.badge", title: "알림", subtitle: "이 기기의 알림 설정", tint: .red) { onOpen(.notifications) }
                    Divider().padding(.leading, 65)
                    SettingsRow(icon: "circle.lefthalf.filled", title: "화면 모드", subtitle: AppAppearance(rawValue: appearance)?.title ?? AppAppearance.system.title, tint: .indigo) { onOpen(.appearance) }
                }
                if hasDeletionHistory {
                    SettingsSection(title: "기기 기록") {
                        SettingsRow(icon: "doc.text", title: "탈퇴 요청 기록", subtitle: "접수 결과와 기기 정리", tint: .gray, action: onDeletionHistory)
                    }
                }
                SettingsSection(title: "앱 정보") {
                    SettingsRow(icon: "info.circle", title: "로기챗 정보", subtitle: "버전 및 앱 정보", tint: .gray) { onOpen(.about) }
                }
            }
            .frame(maxWidth: 600)
            .padding(.horizontal, 20).padding(.top, 12).padding(.bottom, 32)
            .frame(maxWidth: .infinity)
        }
        .background(AppTheme.page)
        .task(id: [account?.id ?? "", account?.displayName ?? "", account?.avatarAssetID ?? "", String(profileRetry)]) {
            profile = nil; profileError = nil
            guard let account, let onLoadProfile else { loadingProfile = false; return }
            loadingProfile = true
            do {
                let value = try await onLoadProfile()
                try Task.checkCancellation()
                guard value.id == account.id else { throw ProductError.sessionChanged }
                profile = value; loadingProfile = false
            } catch {
                if !Task.isCancelled { loadingProfile = false; profileError = (error as? ProductError)?.errorDescription ?? "프로필을 불러오지 못했어요. 다시 시도해 주세요." }
            }
        }
    }
    private var profileHero: some View {
        HStack(alignment: .center, spacing: 18) {
            Group {
                if let profile, (profile.avatarAssetID != nil || profile.providerAvatarURL != nil), let photo = avatar(profile) { photo }
                else { Circle().fill(AppTheme.accent.opacity(0.12))
                .overlay {
                    if let account { Text(String((profile?.displayName ?? account.displayName).prefix(1))).font(.title.weight(.bold)).foregroundStyle(AppTheme.accent) }
                    else { Image(systemName: "person.crop.circle.fill").font(.system(size: 48)).foregroundStyle(AppTheme.accent) }
                }
                .accessibilityHidden(true) }
            }.frame(width: 76, height: 76).clipShape(Circle())
            VStack(alignment: .leading, spacing: 7) {
                Text(profile?.displayName ?? account?.displayName ?? "로기챗에 오신 것을 환영해요").font(.title3.weight(.bold))
                    .fixedSize(horizontal: false, vertical: true)
                if let displayID = profile?.soopDisplayID { Text("SOOP ID · \(displayID)").font(.footnote).foregroundStyle(.secondary).textSelection(.enabled) }
                if let account {
                    Label(account.soopConnected ? "SOOP 계정 연결됨" : "SOOP 계정 연결 필요", systemImage: account.soopConnected ? "checkmark.seal.fill" : "link")
                        .font(.footnote).foregroundStyle(account.soopConnected ? AppTheme.accent : .secondary)
                } else {
                    Text("계정을 연결하고 대화를 시작하세요.").font(.subheadline).foregroundStyle(.secondary)
                    if !capabilities.signInMethods.isEmpty { Button("로그인", action: onSignIn).font(.subheadline.weight(.semibold)) }
                }
            }
            Spacer(minLength: 0)
        }
        .padding(.vertical, 8)
    }
}

struct AppearanceScreen: View {
    @AppStorage("appearance") private var appearance = AppAppearance.system.rawValue
    private var selected: AppAppearance { AppAppearance(rawValue: appearance) ?? .system }
    var body: some View {
        List {
            Section {
                ForEach(AppAppearance.allCases, id: \.self) { option in
                    Button { appearance = option.rawValue } label: {
                        HStack {
                            Text(option.title).foregroundStyle(.primary)
                            Spacer()
                            if selected == option { Image(systemName: "checkmark").fontWeight(.semibold) }
                        }.frame(minHeight: 34).contentShape(Rectangle())
                    }
                    .accessibilityAddTraits(selected == option ? .isSelected : [])
                }
            } footer: { Text("이 기기에서 사용할 화면 모드를 선택해 주세요.") }
        }
    }
}

struct AboutScreen: View {
    private func license(_ name: String) -> String {
        guard let url = Bundle.main.url(forResource: name + "-LICENSE", withExtension: "txt"), let text = try? String(contentsOf: url, encoding: .utf8) else { return "라이선스 정보를 불러오지 못했어요." }
        return text
    }
    private var version: String { Bundle.main.object(forInfoDictionaryKey: "CFBundleShortVersionString") as? String ?? "—" }
    private var build: String { Bundle.main.object(forInfoDictionaryKey: "CFBundleVersion") as? String ?? "—" }
    var body: some View {
        List {
            Section {
                VStack(spacing: 14) {
                    BrandMark(size: 80)
                    Text("로기챗").font(.title2.bold())
                    Text("좋아하는 스트리머와 가까이 나누는 대화")
                        .font(.subheadline).foregroundStyle(.secondary).multilineTextAlignment(.center)
                }.frame(maxWidth: .infinity).padding(.vertical, 24)
                LabeledContent("버전", value: version)
                LabeledContent("빌드", value: build)
                NavigationLink("오픈소스 라이선스") {
                    ScrollView {
                        VStack(alignment: .leading, spacing: 16) {
                            ForEach(["GRDB 7.11.1", "SocketIO 16.1.1", "Starscream 4.0.8"], id: \.self) { package in
                                Text(package).font(.headline)
                                Text(license(String(package.split(separator: " ")[0]))).font(.footnote).textSelection(.enabled)
                            }
                        }.padding().frame(maxWidth: .infinity, alignment: .leading)
                    }.navigationTitle("오픈소스 라이선스")
                }
            }
        }
    }
}
