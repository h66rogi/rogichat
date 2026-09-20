import SwiftUI

// Adapted the complete profile-first MyPageView hub: hero, grouped actions,
// session gating and independent settings navigation. Unrelated commerce is omitted.
struct SettingsScreen: View {
    let account: AccountSummary?
    let capabilities: SessionCapabilities
    let onOpen: (AppPage) -> Void
    let onSignIn: () -> Void
    @AppStorage("appearance") private var appearance = AppAppearance.system.rawValue

    var body: some View {
        ScrollView {
            LazyVStack(alignment: .leading, spacing: 28) {
                profileHero
                if account != nil {
                    SettingsSection(title: "내 계정") {
                        if capabilities.canEditProfile {
                            SettingsRow(icon: "person.crop.circle", title: "프로필 수정", subtitle: "표시 이름과 생일 공개 설정", tint: .mint) { onOpen(.profile) }
                            Divider().padding(.leading, 65)
                        }
                        SettingsRow(icon: "lock.shield", title: "계정 관리", subtitle: "SOOP 연결과 로그인 계정", tint: .indigo) { onOpen(.account) }
                    }
                }
                SettingsSection(title: "앱 설정") {
                    SettingsRow(icon: "bell.badge", title: "알림", subtitle: "이 기기의 알림 설정", tint: .red) { onOpen(.notifications) }
                    Divider().padding(.leading, 65)
                    SettingsRow(icon: "circle.lefthalf.filled", title: "화면 모드", subtitle: AppAppearance(rawValue: appearance)?.title ?? AppAppearance.system.title, tint: .indigo) { onOpen(.appearance) }
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
    }
    private var profileHero: some View {
        HStack(alignment: .center, spacing: 18) {
            Circle().fill(AppTheme.accent.opacity(0.12))
                .overlay {
                    if let account { Text(String(account.displayName.prefix(1))).font(.title.weight(.bold)).foregroundStyle(AppTheme.accent) }
                    else { Image(systemName: "person.crop.circle.fill").font(.system(size: 48)).foregroundStyle(AppTheme.accent) }
                }
                .frame(width: 76, height: 76).accessibilityHidden(true)
            VStack(alignment: .leading, spacing: 7) {
                Text(account?.displayName ?? "로기챗에 오신 것을 환영해요").font(.title3.weight(.bold))
                    .fixedSize(horizontal: false, vertical: true)
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
            }
        }
    }
}
