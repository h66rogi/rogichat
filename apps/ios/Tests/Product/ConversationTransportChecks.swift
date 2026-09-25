import Foundation

#if ROGICHAT_SHARED_STATE_MODULE
@testable import RogichatNativeStateChecks
#endif

private final class ConversationTestBytes: CredentialBytesStoring, @unchecked Sendable {
    private let lock = NSLock(); private var data: Data?
    func read() throws -> Data? { lock.withLock { data } }
    func write(_ value: Data) throws { lock.withLock { data = value } }
    func remove() throws { lock.withLock { data = nil } }
}
private actor ConversationTestAPI: NativeRequesting, ConversationRequesting {
    var session = Data()
    private var blocked = false
    private var pending: CheckedContinuation<Data, any Error>?
    private var waiter: CheckedContinuation<Void, Never>?
    private(set) var requests = 0
    func configure(_ data: Data) { session = data }
    func delay() { blocked = true }
    func perform(_ endpoint: NativeEndpoint, credential: NativeCredential) async throws -> Data { if case .logout = endpoint { return Data() }; return session }
    func performConversation(_ endpoint: ConversationRequest, credential: NativeCredential, scope: ConversationScope) async throws -> Data {
        try scope.check(); requests += 1
        if blocked { blocked = false; return try await withCheckedThrowingContinuation { pending = $0; waiter?.resume(); waiter = nil } }
        throw ConversationError.notFound
    }
    func wait() async { if pending != nil { return }; await withCheckedContinuation { waiter = $0 } }
    func fail() { pending?.resume(throwing: ProductError.unauthenticated); pending = nil }
}
private actor ConversationEntryGate {
    private var blocking = false
    private var pending: CheckedContinuation<Void, Never>?
    private var waiter: CheckedContinuation<Void, Never>?
    func block() { blocking = true }
    func enter() async { guard blocking else { return }; blocking = false; await withCheckedContinuation { pending = $0; waiter?.resume(); waiter = nil } }
    func wait() async { if pending != nil { return }; await withCheckedContinuation { waiter = $0 } }
    func release() { pending?.resume(); pending = nil }
}
private struct DelayedConversationSession: SessionServing, ConversationAuthorizing {
    let base: NativeSessionService
    let gate: ConversationEntryGate
    var capabilities: SessionCapabilities { base.capabilities }
    func restore() async throws -> SessionSnapshot { try await base.restore() }
    func revalidate() async throws -> SessionSnapshot { try await base.revalidate() }
    func signOut() async throws { try await base.signOut() }
    func signIn(_ method: SignInMethod) async throws -> SessionSnapshot { throw ProductError.unavailable }
    func linkSOOP() async throws -> SessionSnapshot { throw ProductError.unavailable }
    func deleteAccount() async throws { throw ProductError.unavailable }
    func loadProfile() async throws -> AccountProfile { try await base.loadProfile() }
    func updateProfile(_ update: ProfileUpdate) async throws -> AccountProfile { try await base.updateProfile(update) }
    func conversationData(_ endpoint: ConversationRequest, scope: ConversationScope) async throws -> Data {
        await gate.enter(); return try await base.conversationData(endpoint, scope: scope)
    }
}
@main struct ConversationTransportChecks {
    static let now = Date(timeIntervalSince1970: 2_000_000_000)
    static let expiry = now.addingTimeInterval(604800)
    static let room = "00000000-0000-4000-8000-000000000001"
    static let actor = "00000000-0000-4000-8000-000000000002"
    static let credential = NativeCredential(token: String(repeating: "a", count: 43), expiresAt: expiry, environment: .qa)
    static func token(_ byte: UInt8) -> String { Data(repeating: byte, count: 32).base64EncodedString().replacingOccurrences(of: "+", with: "-").replacingOccurrences(of: "/", with: "_").replacingOccurrences(of: "=", with: "") }
    static func session(_ partition: UInt8 = 3) throws -> Data {
        let f = ISO8601DateFormatter(); f.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        return try JSONSerialization.data(withJSONObject: ["authenticated": true, "account": ["userId": room, "nickname": "로기", "avatarAssetId": NSNull()], "soopLinkStatus": "VERIFIED", "onboardingState": "READY", "expiresAt": f.string(from: expiry), "accountGeneration": token(4), "accountPartition": token(partition), "capabilities": ["chat": true]])
    }
    static func scope(_ account: RoomsScope) throws -> ConversationScope {
        let room = try JSONDecoder().decode(MembershipRoom.self, from: JSONSerialization.data(withJSONObject: ["roomId": room, "name": "대화", "mode": "GROUP", "actorId": actor, "role": "MEMBER", "membershipScope": token(1), "authorizationRevision": token(2)]))
        return ConversationScope(account: account, room: room, deviceID: self.room, cycle: UUID().uuidString)
    }
    static func check(_ value: Bool) { precondition(value) }
    @MainActor static func main() async throws {
        let directory = FileManager.default.temporaryDirectory.appendingPathComponent("conversation-transport-\(UUID().uuidString)")
        defer { try? FileManager.default.removeItem(at: directory) }
        let bytes = ConversationTestBytes(); let store = NativeCredentialStore(environment: .qa, directory: directory, bytes: bytes)
        _ = try store.read(); check(try store.replace(expected: nil, with: credential))
        let api = ConversationTestAPI(); let base = NativeSessionService(environment: .qa, api: api, store: store, now: { now })
        let gate = ConversationEntryGate(); let app = AppSession(service: DelayedConversationSession(base: base, gate: gate))
        await api.configure(try session()); await app.restore()
        let original = try scope(app.roomsScope!)
        let command = try TextCommand(roomID: room, membershipScope: token(1), text: "전송 요청")
        let request = try ConversationRequest.send(command).request(environment: .qa, credential: credential, scope: original)
        check(request.httpMethod == "POST" && request.url?.path == "/v1/rooms/\(room)/messages")
        check(request.value(forHTTPHeaderField: "Authorization") == "Bearer \(credential.token)" && request.value(forHTTPHeaderField: "X-Rogi-Client") == "ios")
        for field in ["Cookie", "Origin", "X-CSRF-Token"] { check(request.value(forHTTPHeaderField: field) == nil) }
        check(!request.httpShouldHandleCookies && request.cachePolicy == .reloadIgnoringLocalCacheData)
        let snapshot = try ConversationRequest.read(.snapshot).request(environment: .qa, credential: credential, scope: original)
        let query = URLComponents(url: snapshot.url!, resolvingAgainstBaseURL: false)!.queryItems!
        check(query.contains(URLQueryItem(name: "cacheId", value: original.cacheID)) && !query.contains(where: { $0.name == "cursor" }))
        check(query.contains(URLQueryItem(name: "limit", value: "20")))
        for endpoint in [ConversationQuery.events(cursor: "events"), .history(cursor: "history")] {
            let page = try ConversationRequest.read(endpoint).request(environment: .qa, credential: credential, scope: original)
            check(URLComponents(url: page.url!, resolvingAgainstBaseURL: false)!.queryItems!.contains(URLQueryItem(name: "limit", value: "20")))
        }
        let maximum = String(repeating: "😀", count: 4_000)
        let fullMessage: [String: Any] = ["id": room, "version": "18446744073709551615", "createdAt": "2026-09-20T01:02:03.004Z", "audience": "SHARED", "author": ["kind": "member", "actorId": actor, "nickname": String(repeating: "😀", count: 40), "avatar": NSNull()], "content": ["type": "TEXT", "text": maximum], "quote": ["id": actor, "content": ["type": "TEXT", "text": maximum]], "counterpart": NSNull(), "allowedActions": ["reply": true, "publish": false, "delete": false]]
        let bounded = try JSONSerialization.data(withJSONObject: ["messages": Array(repeating: fullMessage, count: 20)])
        let oversized = try JSONSerialization.data(withJSONObject: ["messages": Array(repeating: fullMessage, count: 100)])
        check(bounded.count < NativeAPIClient.maximumBodyBytes && oversized.count > NativeAPIClient.maximumBodyBytes)
        let profiles = try ConversationRequest.read(.profiles(cursor: nil)).request(environment: .qa, credential: credential, scope: original)
        check(URLComponents(url: profiles.url!, resolvingAgainstBaseURL: false)!.queryItems!.contains(URLQueryItem(name: "cacheId", value: original.profileCacheID)))
        check(URLComponents(url: profiles.url!, resolvingAgainstBaseURL: false)!.queryItems!.contains(URLQueryItem(name: "limit", value: "100")))
        let mismatch = Data(#"{"error":{"code":"MEMBERSHIP_SCOPE_MISMATCH"}}"#.utf8)
        check(ConversationRequest.error(data: mismatch, status: 409) as? ConversationError == .membershipChanged)
        check(ConversationRequest.error(data: Data(), status: 404) as? ConversationError == .notFound)
        check(ConversationRequest.error(data: Data(), status: 401) as? ProductError == .unauthenticated)
        check(ConversationRequest.error(data: Data(), status: 400) as? ConversationError == .invalidResponse)
        check(ConversationRequest.error(data: Data(), status: 413, writing: true) as? ConversationError == .invalidText)
        await gate.block()
        let beforeEntry = Task { try await app.conversationData(.send(command), scope: original) }
        await gate.wait()
        await api.configure(try session(9)); await app.restore()
        await api.configure(try session()); await app.restore()
        await gate.release()
        do { _ = try await beforeEntry.value; preconditionFailure() } catch { }
        check(await api.requests == 0)
        let current = try scope(app.roomsScope!)
        await api.delay()
        let inflight = Task { try await app.conversationData(.send(command), scope: current) }
        await api.wait()
        do { _ = try await base.conversationData(.send(command), scope: current); preconditionFailure() } catch { check(error as? ConversationError == .busy) }
        await app.restore(); await api.fail()
        do { _ = try await inflight.value; preconditionFailure() } catch { }
        check(await api.requests == 1)
        check(try store.read() == credential && app.access == .ready)
        let authoritative = try scope(app.roomsScope!)
        await api.delay(); let rejected = Task { try await app.conversationData(.read(.snapshot), scope: authoritative) }
        await api.wait(); await api.fail()
        do { _ = try await rejected.value; preconditionFailure() } catch { }
        check(try store.read() == nil && app.account == nil)
        print("iOS conversation transport: fixed routes/headers, immutable actor-hop scope, one-shot admission and current-token-only 401 passed")
    }
}
