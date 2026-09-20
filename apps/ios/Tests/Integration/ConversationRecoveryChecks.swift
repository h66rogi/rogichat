import Foundation
import RogichatRooms

// No network or system Keychain: actual native service, AppSession, repository,
// coordinator and on-disk GRDB are exercised with explicitly injected boundaries.
private final class RecoveryBytes: CredentialBytesStoring, @unchecked Sendable {
    private let lock = NSLock(); private var data: Data?
    func read() throws -> Data? { lock.withLock { data } }
    func write(_ value: Data) throws { lock.withLock { data = value } }
    func remove() throws { lock.withLock { data = nil } }
}
private actor RecoveryAPI: NativeRequesting, RoomsRequesting, ConversationRequesting {
    private(set) var calls: [String] = []
    private(set) var sends = 0
    private var result = "unknown"
    static let room = "00000000-0000-4000-8000-000000000001"
    static let actor = "00000000-0000-4000-8000-000000000002"
    static let message = "00000000-0000-4000-8000-000000000003"
    static let now = Date(timeIntervalSince1970: 2_000_000_000)
    static let expires = now.addingTimeInterval(604800)
    static func token(_ byte: UInt8) -> String { Data(repeating: byte, count: 32).base64EncodedString().replacingOccurrences(of: "+", with: "-").replacingOccurrences(of: "/", with: "_").replacingOccurrences(of: "=", with: "") }
    private func data(_ object: [String: Any]) throws -> Data { try JSONSerialization.data(withJSONObject: object) }
    func setResult(_ value: String) { result = value }
    func perform(_ endpoint: NativeEndpoint, credential: NativeCredential) async throws -> Data {
        guard case .session = endpoint else { throw ProductError.unavailable }; calls.append("session")
        let f = ISO8601DateFormatter(); f.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        return try data(["authenticated": true, "account": ["userId": Self.actor, "nickname": "현재 계정", "avatarAssetId": NSNull()], "soopLinkStatus": "VERIFIED", "onboardingState": "READY", "expiresAt": f.string(from: Self.expires), "accountGeneration": Self.token(4), "accountPartition": Self.token(3), "capabilities": ["chat": true]])
    }
    func performRooms(_ endpoint: RoomsQuery, credential: NativeCredential, scope: RoomsScope) async throws -> Data {
        try scope.check()
        switch endpoint {
        case .discovery: calls.append("discovery"); return try data(["rooms": [], "next": NSNull()])
        case .manifest:
            calls.append("manifest")
            return try data(["schemaVersion": 2, "resetRequired": false, "rooms": [["roomId": Self.room, "name": "대화", "mode": "GROUP", "actorId": Self.actor, "role": "MEMBER", "membershipScope": Self.token(1), "authorizationRevision": Self.token(2)]], "generation": Self.token(5), "complete": true, "nextCursor": NSNull()])
        }
    }
    func performConversation(_ endpoint: ConversationRequest, credential: NativeCredential, scope: ConversationScope) async throws -> Data {
        try scope.check()
        switch endpoint {
        case .send: calls.append("send"); sends += 1; throw ConversationError.unavailable
        case .read(let query):
            switch query {
            case .snapshot:
                calls.append("snapshot")
                return try data(["schemaVersion": 2, "resetRequired": false, "membershipScope": Self.token(1), "authorizationRevision": Self.token(2), "messages": [], "nextCursor": "events-0", "historyCursor": NSNull()])
            case .profiles:
                calls.append("profiles")
                return try data(["schemaVersion": 2, "resetRequired": false, "membershipScope": Self.token(1), "authorizationRevision": Self.token(2), "profiles": [], "generation": Self.token(5), "complete": true, "nextCursor": NSNull()])
            case .receipt(let id):
                calls.append("receipt")
                if result == "unknown" { throw ConversationError.notFound }
                if result == "deleted" { return try data(["clientMessageId": id, "status": "deleted"]) }
                return try data(["clientMessageId": id, "messageId": Self.message, "status": "committed", "version": "1"])
            case .message:
                calls.append("message")
                return try data(["id": Self.message, "version": "1", "createdAt": "2026-09-20T01:02:03.004Z", "audience": "SHARED", "author": ["kind": "member", "actorId": Self.actor, "nickname": "현재 계정", "avatar": NSNull()], "content": ["type": "TEXT", "text": "원래 본문"], "quote": NSNull(), "counterpart": NSNull(), "allowedActions": ["reply": false, "publish": false, "delete": true]])
            default: throw ConversationError.notFound
            }
        }
    }
}
@main struct ConversationRecoveryChecks {
    static func check(_ value: Bool) { precondition(value) }
    @MainActor static func main() async throws {
        let root = FileManager.default.temporaryDirectory.appendingPathComponent("conversation-native-recovery-\(UUID().uuidString)")
        defer { try? FileManager.default.removeItem(at: root) }
        let bytes = RecoveryBytes()
        let store = NativeCredentialStore(environment: .qa, directory: root.appendingPathComponent("credentials"), bytes: bytes)
        _ = try store.read()
        let credential = NativeCredential(token: String(repeating: "a", count: 43), expiresAt: RecoveryAPI.expires, environment: .qa)
        check(try store.replace(expected: nil, with: credential))
        let api = RecoveryAPI(); let storage = RoomsStorage(root: root.appendingPathComponent("rooms"))
        let service = NativeSessionService(environment: .qa, api: api, store: store, now: { RecoveryAPI.now }, purgeRooms: { try storage.purge() })
        let app = AppSession(service: service); await app.restore(); check(app.access == .ready)
        let original = app.roomsScope!; let remote = NativeRoomsRemote(session: app)
        let repository = RoomsRepository(remote: remote, storage: storage, scope: original)
        let directory = try await repository.refresh()
        let coordinator = try await repository.openConversation(roomID: RecoveryAPI.room, cycle: directory.cycle!)
        _ = try await coordinator.refresh()
        let command = try TextCommand(roomID: RecoveryAPI.room, membershipScope: RecoveryAPI.token(1), text: "원래 본문")
        check(try await coordinator.send(command).commands.first?.phase == .unknown)
        check(await api.sends == 1)
        let database = try storage.open(scope: original); original.invalidate(); try database.close()
        // Recreate every service/owner and reopen actual SQLite, retaining only the protected bytes and files.
        let reopenedStore = NativeCredentialStore(environment: .qa, directory: root.appendingPathComponent("credentials"), bytes: bytes)
        let reopenedStorage = RoomsStorage(root: root.appendingPathComponent("rooms"))
        let restartedService = NativeSessionService(environment: .qa, api: api, store: reopenedStore, now: { RecoveryAPI.now }, purgeRooms: { try reopenedStorage.purge() })
        let restartedApp = AppSession(service: restartedService); let checkpoint = await api.calls.count
        await restartedApp.restore(); check(restartedApp.access == .ready && restartedApp.roomsScope !== original)
        let reopenedRepository = RoomsRepository(remote: NativeRoomsRemote(session: restartedApp), storage: reopenedStorage, scope: restartedApp.roomsScope!)
        let authoritative = try await reopenedRepository.refresh()
        let recovered = try await reopenedRepository.openConversation(roomID: RecoveryAPI.room, cycle: authoritative.cycle!)
        let unresolved = try await recovered.refresh()
        check(unresolved.commands.first?.id == command.id && unresolved.commands.first?.phase == .unknown)
        check(await api.sends == 1)
        let recoveryCalls = Array(await api.calls.dropFirst(checkpoint))
        check(recoveryCalls.first == "session")
        check(recoveryCalls.firstIndex(of: "manifest")! < recoveryCalls.firstIndex(of: "receipt")!)
        check(!recoveryCalls.contains("send"))
        await api.setResult("committed")
        let known = try await recovered.reconcile(); check(known.commands.isEmpty && known.messages.count == 1)
        let beforeRetirement = await api.calls.count
        _ = try await recovered.reconcile(); check(await api.calls.count == beforeRetirement)
        check(await api.sends == 1)
        let reopenedDatabase = try reopenedStorage.open(scope: restartedApp.roomsScope!); restartedApp.roomsScope!.invalidate(); try reopenedDatabase.close()
        print("iOS native cold recovery: injected protected store -> real restore -> complete manifest -> actual SQLite reopen -> GET receipt only; unknown404/latecommit/retirement, POST1 total passed")
    }
}
