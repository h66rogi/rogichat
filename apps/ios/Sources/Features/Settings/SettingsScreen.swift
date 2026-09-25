import SwiftUI

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

struct OpenSourceLicensesScreen: View {
    private func license(_ name: String) -> String {
        guard let url = Bundle.main.url(forResource: name + "-LICENSE", withExtension: "txt"), let text = try? String(contentsOf: url, encoding: .utf8) else { return "라이선스 정보를 불러오지 못했어요." }
        return text
    }
    var body: some View {
        List {
            Section {
                ForEach(["GRDB 7.11.1", "SocketIO 16.1.1", "Starscream 4.0.8"], id: \.self) { package in
                    NavigationLink(package) {
                        ScrollView {
                            Text(license(String(package.split(separator: " ")[0])))
                                .font(.footnote)
                                .textSelection(.enabled)
                                .frame(maxWidth: .infinity, alignment: .leading)
                                .padding()
                        }
                        .navigationTitle(package)
                    }
                }
            }
        }
    }
}

struct AccessCapabilities: Decodable {
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

// Account security remains available to password users; admin actions live in DeveloperToolsView.
struct AccountAccessSettings: View {
    let session: AppSession
    @State private var capabilities: AccessCapabilities?
    @State private var error: String?
    @State private var retry = 0
    @State private var showPassword = false
    var body: some View {
        Group {
            if let error {
                Section("계정 보안") {
                    Text(error).font(.footnote).foregroundStyle(.secondary)
                    Button("다시 확인") { retry += 1 }
                }
            } else if capabilities?.password.enabled == true {
                Section("계정 보안") {
                    DisclosureGroup("비밀번호 변경",isExpanded:$showPassword) {
                        PasswordForm(changing:true,busy:session.busy) { input in Task { await session.password(input) } }.padding(.top,12)
                    }
                }
            }
        }
        .task(id:retry) {
            capabilities = nil; error = nil
            let generation = session.generation
            do { let data = try await session.accessRequest(.me,expected:generation); try Task.checkCancellation(); capabilities = try JSONDecoder().decode(AccessCapabilities.self,from:data) }
            catch { if !Task.isCancelled { self.error = "계정 권한을 확인하지 못했어요." } }
        }
    }
}
struct RoomTestAccess: View {
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
