import SwiftUI

// Adapted the complete profile-first MyPageView hub: hero, grouped actions,
// session gating and independent settings navigation. Unrelated commerce is omitted.
struct SettingsScreen: View {
    var accessSession: AppSession? = nil
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
                if account != nil, let accessSession { AccountAccessSettings(session:accessSession) }
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

private struct AccessCapabilities: Decodable {
    struct Admin: Decodable { let enabled: Bool; let manageTestAccess: Bool; let manageReviewers: Bool }
    struct Password: Decodable { let enabled: Bool }
    let chat: Bool; let admin: Admin; let password: Password
}
private struct TestGrant: Decodable, Identifiable {
    let grantId: UUID; let roomId: UUID; let expiresAt: String; let revokedAt: String?
    var id: UUID { grantId }
    var expiry: Date? { accessDate(expiresAt) }
}
private struct TestGrantPage: Decodable { let grants: [TestGrant]; let next: UUID? }
private struct RoomAccess: Decodable {
    struct Temporary: Decodable { let grantId: UUID; let expiresAt: String }
    let effectiveRole: String; let canSendShared: Bool; let canSendToOwner: Bool
    let canReadFanInbox: Bool; let canPublish: Bool; let canModerate: Bool
    let temporaryStreamer: Temporary?
}
private struct AdminRooms: Decodable {
    struct Room: Decodable { let roomId: UUID; let name: String; let isDefault: Bool? }
    let rooms: [Room]; let next: UUID?
}
private func accessDate(_ value: String) -> Date? {
    let format = ISO8601DateFormatter(); format.formatOptions = [.withInternetDateTime,.withFractionalSeconds]
    if let date = format.date(from:value) { return date }
    format.formatOptions = [.withInternetDateTime]; return format.date(from:value)
}

// Same settings section/action/async retry pattern as the adapted Meloming hub.
private struct AccountAccessSettings: View {
    let session: AppSession
    @State private var capabilities: AccessCapabilities?
    @State private var error: String?
    @State private var retry = 0
    @State private var showPassword = false
    @State private var showAdmin = false
    var body: some View {
        SettingsSection(title:"계정 보안") {
            if let error { Text(error).font(.footnote).foregroundStyle(.secondary); Button("다시 확인") { retry += 1 } }
            if let capabilities {
                if capabilities.password.enabled {
                    DisclosureGroup("비밀번호 변경",isExpanded:$showPassword) {
                        PasswordForm(changing:true,busy:session.busy) { input, _ in Task { await session.password(input) } }.padding(.top,12)
                    }.padding()
                }
                if capabilities.admin.enabled {
                    DisclosureGroup("관리자",isExpanded:$showAdmin) {
                        if capabilities.admin.manageTestAccess { RoomTestAccess(session:session) }
                        else { Text("현재 사용할 수 있는 관리 권한이 없어요.").font(.footnote) }
                    }.padding()
                }
                if !capabilities.password.enabled && !capabilities.admin.enabled { Text("연결된 로그인 계정은 계정 관리에서 확인할 수 있어요.").font(.footnote).foregroundStyle(.secondary).padding() }
            } else if error == nil { ProgressView("계정 권한을 확인하는 중").padding() }
        }.task(id:retry) {
            capabilities = nil; error = nil
            let generation = session.generation
            do { let data = try await session.accessRequest(.me,expected:generation); try Task.checkCancellation(); capabilities = try JSONDecoder().decode(AccessCapabilities.self,from:data) }
            catch { if !Task.isCancelled { self.error = "계정 권한을 확인하지 못했어요." } }
        }
    }
}
private struct RoomTestAccess: View {
    let session: AppSession
    @State private var room: AdminRooms.Room?
    @State private var role: RoomAccess?
    @State private var grants: [TestGrant] = []
    @State private var after: UUID?
    @State private var reason = ""
    @State private var duration = 900
    @State private var busy = false
    @State private var uncertain = false
    @State private var error: String?
    private var reasonValid: Bool { !reason.trimmingCharacters(in:.whitespacesAndNewlines).isEmpty && reason.unicodeScalars.count <= 200 && !reason.unicodeScalars.contains { $0.value < 32 || $0.value == 127 } }
    var body: some View {
        VStack(alignment:.leading,spacing:12) {
            Text("기본방 임시 권한").font(.headline)
            Text("내 계정에만 최대 1시간 동안 방장 기능을 부여합니다. 실제 방장 계정은 변경하지 않습니다.").font(.footnote).foregroundStyle(.secondary)
            if busy { ProgressView() }
            if let error { Text(error).font(.footnote).foregroundStyle(.red) }
            Button("현재 권한 다시 확인") { Task { await load() } }.disabled(busy)
            if let room {
                Text(room.name).font(.headline)
                if let role { Text("현재 역할: " + (role.effectiveRole == "STREAMER" ? "방장" : role.effectiveRole == "FAN" ? "팬" : "참여자")) }
                if let expiry = role?.temporaryStreamer.flatMap({ accessDate($0.expiresAt) }) { Text("임시 권한 만료: \(expiry.formatted())").font(.footnote) }
                TextField("변경 사유",text:$reason).textFieldStyle(.roundedBorder).disabled(busy)
                Picker("권한 유지 시간",selection:$duration) { Text("5분").tag(300); Text("15분").tag(900); Text("1시간").tag(3600) }.pickerStyle(.segmented).disabled(busy)
                Button("내 계정에 임시 권한 부여") { Task { await command() } }.buttonStyle(.borderedProminent)
                    .disabled(busy || uncertain || !reasonValid || role?.effectiveRole != "FAN")
                ForEach(grants) { grant in
                    let expired = (grant.expiry ?? .distantPast) <= Date()
                    VStack(alignment:.leading,spacing:6) {
                        Text(grant.revokedAt != nil ? "회수됨" : expired ? "만료됨" : "임시 권한 사용 중")
                        if let expiry = grant.expiry { Text(expiry.formatted()).font(.footnote).foregroundStyle(.secondary) }
                        if grant.revokedAt == nil && !expired { Button("임시 권한 회수") { Task { await command(grant:grant.grantId) } }.disabled(busy || !reasonValid) }
                    }
                }
                if after != nil { Button("이전 기록 더 보기") { Task { await load(more:true) } }.disabled(busy) }
            } else if !busy && error == nil { Text("현재 등록된 기본방이 없어요.") }
        }.padding(.top,12).task { await load() }
        .task(id:role?.temporaryStreamer?.expiresAt) {
            guard let expiry = role?.temporaryStreamer.flatMap({ accessDate($0.expiresAt) }) else { return }
            do { try await Task.sleep(for:.seconds(max(0.1,expiry.timeIntervalSinceNow))); await load() } catch {}
        }
    }
    private func load(more: Bool = false) async {
        busy = true; error = nil; defer { busy = false }
        let generation = session.generation
        do {
            let caps = try JSONDecoder().decode(AccessCapabilities.self,from:await session.accessRequest(.me,expected:generation))
            guard caps.admin.enabled && caps.admin.manageTestAccess else { throw ProductError.unavailable }
            if room == nil {
                var cursor: UUID?; var seen = Set<UUID>()
                repeat {
                    let page = try JSONDecoder().decode(AdminRooms.self,from:await session.accessRequest(.rooms(cursor?.uuidString.lowercased()),expected:generation))
                    let candidates = page.rooms.filter { $0.isDefault == true }; guard candidates.count <= 1 else { throw ProductError.invalidResponse }
                    if let found = candidates.first { room = found; break }
                    cursor = page.next
                    if let cursor { guard seen.insert(cursor).inserted, seen.count < 100 else { throw ProductError.invalidResponse } }
                } while cursor != nil
            }
            guard let room else { role = nil; grants = []; return }
            let id = room.roomId.uuidString.lowercased()
            let latest = try JSONDecoder().decode(RoomAccess.self,from:await session.accessRequest(.room(id),expected:generation))
            guard ["FAN","MEMBER","STREAMER"].contains(latest.effectiveRole), latest.temporaryStreamer == nil || latest.temporaryStreamer.flatMap({ accessDate($0.expiresAt) }) != nil else { throw ProductError.invalidResponse }
            let page = try JSONDecoder().decode(TestGrantPage.self,from:await session.accessRequest(.grants(id,more ? after?.uuidString.lowercased() : nil),expected:generation))
            guard page.grants.allSatisfy({ $0.roomId == room.roomId && $0.expiry != nil }) else { throw ProductError.invalidResponse }
            try Task.checkCancellation(); role = latest
            grants = more ? grants + page.grants.filter { item in !grants.contains { $0.id == item.id } } : page.grants; after = page.next
        } catch { if !Task.isCancelled { role = nil; self.error = "권한을 확인하지 못했어요. 기본방 참여 여부와 관리 권한을 확인한 뒤 다시 시도해 주세요." } }
    }
    private func command(grant: UUID? = nil) async {
        guard !busy, reasonValid, let room else { return }
        busy = true; error = nil; let generation = session.generation; var failed = false
        do {
            let id = room.roomId.uuidString.lowercased()
            let request: AccountAccessRequest = grant.map { .revoke(id,$0.uuidString.lowercased(),reason) } ?? .issue(id,UUID(),duration,reason)
            _ = try await session.accessRequest(request,expected:generation)
        } catch { failed = true; uncertain = true }
        await session.refreshAccessScope(expected:generation)
        await load()
        if failed { error = "변경 결과를 확인하지 못했어요. 요청을 반복하지 않고 현재 권한을 다시 조회했습니다." }
    }
}
