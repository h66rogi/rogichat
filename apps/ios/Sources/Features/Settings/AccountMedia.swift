import Foundation
import SwiftUI
import RogichatRooms

struct AccountMediaScope: MediaScope {
    let original: RoomsScope
    var presentationID: String { original.clientScope.uuidString }
    var roomID: String? { nil }
    func check() throws { try original.check(); try MediaScratchLifecycle.shared.prepare() }
}
struct AccountMediaTransport: MediaTransport {
    let session: AppSession
    let original: RoomsScope
    func perform(_ request: MediaRequest, scope: any MediaScope) async throws -> Data {
        guard let scope = scope as? AccountMediaScope, scope.original === original else { throw MediaError.expired }
        try scope.check()
        return try await session.accountFeatureData(ConversationFeatureRequest(method: request.method, path: request.path,
            body: request.jsonBody, upload: request.upload?.url, uploadBytes: request.upload?.byteLength, expectedStatus: request.expectedStatus), scope: original)
    }
}
struct AccountMediaJournal: MediaJournal {
    let database: RoomsDatabase
    let accountID: String
    func save(_ pending: PendingMedia, scope: any MediaScope) throws {
        guard let scope = scope as? AccountMediaScope, scope.original === database.scope, pending.kind == .avatar else { throw MediaError.expired }
        try database.putAccountFeature(.avatar, room: accountID, id: pending.assetId, value: JSONEncoder().encode(pending))
    }
    func remove(_ assetID: String, scope: any MediaScope) throws {
        guard let scope = scope as? AccountMediaScope, scope.original === database.scope else { throw MediaError.expired }
        try database.removeAccountFeature(.avatar, room: accountID, id: assetID)
    }
}
struct AccountAvatarSection: View {
    let session: AppSession
    let storage: RoomsStorage
    let scope: RoomsScope
    let accountID: String
    let originalAssetID: String?
    let apiBaseURL: URL
    var originalProviderAvatarAvailable = false
    @State private var providerAvatarAvailable = false
    @State private var journal: AccountMediaJournal?
    @State private var currentAssetID: String?
    @State private var pending: [PendingMedia] = []
    @State private var error: String?
    @State private var busy = false
    private var client: MediaClient { MediaClient(transport: AccountMediaTransport(session: session, original: scope), scope: AccountMediaScope(original: scope), apiBaseURL: apiBaseURL) }
    var body: some View {
        Section {
            if let asset = currentAssetID {
                AuthorizedMedia(client: client, assetID: asset, access: .preview(.image), avatar: true).frame(width: 96, height: 96).clipShape(Circle())
            }
            if currentAssetID == nil && providerAvatarAvailable { AuthorizedProviderAvatar(client: client).frame(width: 96, height: 96).clipShape(Circle()) }
            if let journal {
                MediaPicker(kind: .avatar, enabled: !busy, scope: client.scope) { file in
                    busy = true; error = nil; defer { busy = false }
                    let upload = MediaUpload(client: client, journal: journal)
                    do {
                        let ready = try await upload.start(file)
                        try await client.updateAvatar(ready)
                        try await upload.acknowledged(ready.assetId)
                        await confirmed()
                    } catch { self.error = "프로필 사진 변경 결과를 확인하지 못했어요. 현재 프로필을 다시 확인해 주세요."; await readPending(); throw error }
                }
                if currentAssetID != nil || providerAvatarAvailable {
                    Button("프로필 사진 삭제", role: .destructive) { Task {
                        busy = true; defer { busy = false }
                        do { try await client.updateAvatar(nil); await confirmed() }
                        catch { self.error = "프로필 사진 변경 결과를 확인하지 못했어요." }
                    } }.disabled(busy)
                }
                ForEach(pending, id: \.assetId) { item in
                    Button("이전 프로필 사진 업로드 확인") { Task {
                        busy = true; defer { busy = false }
                        do {
                            let receipt = try await client.status(item.assetId)
                            if receipt.status == .ready { error = "업로드는 완료되었어요. 프로필 반영 여부는 현재 프로필을 다시 확인해 주세요." }
                            else { error = "업로드 처리가 아직 완료되지 않았어요." }
                        } catch { self.error = "이전 업로드 상태를 확인하지 못했어요." }
                    } }.disabled(busy)
                }
            } else if error == nil { ProgressView("프로필 사진 확인 중") }
            else { Button("사진 작업 기록 다시 확인") { Task { await load() } } }
            if let error { Text(error).font(.footnote).foregroundStyle(.secondary) }
            Button("현재 프로필 사진 다시 확인") { Task { await confirmed() } }.disabled(busy)
        } header: { Text("프로필 사진") } footer: { Text("프로필 사진은 선택하거나 삭제하면 바로 반영돼요.") }
        .task { await load() }
    }
    private func load() async {
        error = nil
        do { journal = AccountMediaJournal(database: try storage.open(scope: scope), accountID: accountID); currentAssetID = originalAssetID; providerAvatarAvailable = originalProviderAvatarAvailable; await readPending() }
        catch { self.error = "기기의 사진 작업 기록을 읽지 못했어요." }
    }
    private func readPending() async {
        guard let journal else { return }
        do { pending = try journal.database.accountRecords(.avatar, room: accountID).map { let value = try JSONDecoder().decode(PendingMedia.self, from: $0)
            _ = try mediaID(value.assetId); guard value.kind == .avatar else { throw MediaError.invalid }; return value } }
        catch { self.error = "기기의 업로드 기록을 읽지 못했어요." }
    }
    private func confirmed() async {
        do {
            let profile = try await session.loadProfile(); try scope.check(); guard profile.id == accountID else { throw ProductError.sessionChanged }
            currentAssetID = profile.avatarAssetID; providerAvatarAvailable = profile.providerAvatarURL != nil; await session.revalidate(); await readPending()
        } catch { self.error = "현재 프로필 사진을 확인하지 못했어요." }
    }
}
