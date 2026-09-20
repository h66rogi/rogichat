import Foundation

final class RoomsTestBytes: CredentialBytesStoring, @unchecked Sendable {
    private let lock = NSLock(); private var data: Data?
    func read() throws -> Data? { lock.withLock { data } }
    func write(_ value: Data) throws { lock.withLock { data = value } }
    func remove() throws { lock.withLock { data = nil } }
}
final class RoomsPurgeProbe: @unchecked Sendable {
    private let lock = NSLock(); private var failure = false; private var calls = 0
    func fail(_ value: Bool) { lock.withLock { failure = value } }
    func purge() throws { try lock.withLock { calls += 1; if failure { throw RoomsError.persistence } } }
    var count: Int { lock.withLock { calls } }
}
actor RoomsTestAPI: NativeRequesting, RoomsRequesting {
    var session = Data()
    private var blocked = false
    private var pending: CheckedContinuation<Data, any Error>?
    private var waiter: CheckedContinuation<Void, Never>?
    private(set) var requests = 0
    func configure(_ data: Data) { session = data }
    func delay() { blocked = true }
    func perform(_ endpoint: NativeEndpoint, credential: NativeCredential) async throws -> Data {
        if case .logout = endpoint { return Data() }; return session
    }
    func performRooms(_ endpoint: RoomsEndpoint, credential: NativeCredential, scope: RoomsScope) async throws -> Data {
        try scope.check(); requests += 1
        if blocked { blocked = false; return try await withCheckedThrowingContinuation { pending = $0; waiter?.resume(); waiter = nil } }
        return Data(#"{"rooms":[],"next":null}"#.utf8)
    }
    func wait() async { if pending != nil { return }; await withCheckedContinuation { waiter = $0 } }
    func fail() { pending?.resume(throwing: ProductError.unauthenticated); pending = nil }
}
actor RoomsEntryGate {
    private var blocking = false
    private var pending: CheckedContinuation<Void, Never>?
    private var waiter: CheckedContinuation<Void, Never>?
    func block() { blocking = true }
    func enter() async {
        guard blocking else { return }; blocking = false
        await withCheckedContinuation { pending = $0; waiter?.resume(); waiter = nil }
    }
    func wait() async { if pending != nil { return }; await withCheckedContinuation { waiter = $0 } }
    func release() { pending?.resume(); pending = nil }
}
struct DelayedRoomsSession: SessionServing, RoomsAuthorizing {
    let base: NativeSessionService
    let gate: RoomsEntryGate
    var capabilities: SessionCapabilities { base.capabilities }
    func restore() async throws -> SessionSnapshot { try await base.restore() }
    func revalidate() async throws -> SessionSnapshot { try await base.revalidate() }
    func signOut() async throws { try await base.signOut() }
    func signIn(_ method: SignInMethod) async throws -> SessionSnapshot { throw ProductError.unavailable }
    func linkSOOP() async throws -> SessionSnapshot { throw ProductError.unavailable }
    func deleteAccount() async throws { throw ProductError.unavailable }
    func loadProfile() async throws -> AccountProfile { try await base.loadProfile() }
    func updateProfile(_ update: ProfileUpdate) async throws -> AccountProfile { try await base.updateProfile(update) }
    func roomsData(_ endpoint: RoomsQuery, scope: RoomsScope) async throws -> Data {
        await gate.enter()
        return try await base.roomsData(endpoint, scope: scope)
    }
}
@main struct RoomsTransportChecks {
    static let now = Date(timeIntervalSince1970: 2_000_000_000)
    static let expires = now.addingTimeInterval(604800)
    static let credential = NativeCredential(token: String(repeating: "a", count: 43), expiresAt: expires, environment: .qa)
    static func token(_ byte: UInt8) -> String { Data(repeating: byte, count: 32).base64EncodedString().replacingOccurrences(of: "+", with: "-").replacingOccurrences(of: "/", with: "_").replacingOccurrences(of: "=", with: "") }
    static func session(partition: String? = nil, linked: Bool = true) throws -> Data {
        let formatter = ISO8601DateFormatter(); formatter.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        var object: [String: Any] = ["authenticated": true, "account": ["userId": "00000000-0000-4000-8000-000000000001", "nickname": "로기", "avatarAssetId": NSNull()], "soopLinkStatus": linked ? "VERIFIED" : "REQUIRED", "onboardingState": linked ? "READY" : "SOOP_LINK_REQUIRED", "expiresAt": formatter.string(from: expires), "accountGeneration": token(1), "capabilities": ["chat": linked]]
        if let partition { object["accountPartition"] = partition }
        return try JSONSerialization.data(withJSONObject: object)
    }
    static func check(_ value: Bool) { precondition(value) }
    @MainActor static func main() async throws {
        let directory = FileManager.default.temporaryDirectory.appendingPathComponent("rooms-transport-\(UUID().uuidString)")
        defer { try? FileManager.default.removeItem(at: directory) }
        let bytes = RoomsTestBytes(); let store = NativeCredentialStore(environment: .qa, directory: directory, bytes: bytes)
        _ = try store.read(); check(try store.replace(expected: nil, with: credential))
        let api = RoomsTestAPI(); let purge = RoomsPurgeProbe()
        let service = NativeSessionService(environment: .qa, api: api, store: store, now: { now }, purgeRooms: { try purge.purge() })
        let entry = RoomsEntryGate()
        let app = AppSession(service: DelayedRoomsSession(base: service, gate: entry))
        await api.configure(try session()); await app.restore()
        check(app.access == .ready && app.roomsScope == nil) // No userId fallback.
        await api.configure(try session(partition: token(2), linked: false)); await app.revalidate()
        check(app.access == .linkRequired && app.roomsScope == nil)
        let restrictedGeneration = app.generation
        await app.revalidate()
        check(app.generation == restrictedGeneration) // Partition does not reset LINK_REQUIRED settings on every foreground.
        await api.configure(try session(partition: token(2))); await app.revalidate()
        let a = app.roomsScope!; let generation = app.generation
        await app.revalidate()
        check(app.roomsScope === a && app.generation == generation)
        let request = try RoomsEndpoint.manifest(deviceID: "00000000-0000-4000-8000-000000000001", cacheID: "00000000-0000-4000-8000-000000000002", cursor: nil).request(environment: .qa, credential: credential)
        check(request.url?.path == "/v1/sync" && request.httpBody == nil && request.httpMethod == "GET")
        check(request.value(forHTTPHeaderField: "X-Rogi-Client") == "ios")
        for field in ["Cookie", "Origin", "X-CSRF-Token"] { check(request.value(forHTTPHeaderField: field) == nil) }
        // Partition rotation changes local scope even when account ID/generation stay equal.
        await api.configure(try session(partition: token(3))); await app.revalidate()
        check(app.roomsScope !== a && app.generation != generation)
        do { _ = try await service.roomsData(.discovery(after: nil), scope: a); preconditionFailure() } catch { check(error as? RoomsError == .staleScope) }
        check(await api.requests == 0)
        // The UI admits A, then service entry is delayed across A -> B -> A.
        let admitted = app.roomsScope!
        await entry.block()
        let hop = Task { try await app.roomsData(.discovery(after: nil), scope: admitted) }
        await entry.wait()
        await api.configure(try session(partition: token(2))); await app.restore()
        await api.configure(try session(partition: token(3))); await app.restore()
        await entry.release()
        do { _ = try await hop.value; preconditionFailure() } catch { check(error as? RoomsError == .staleScope) }
        check(await api.requests == 0)
        let b = app.roomsScope!
        await api.delay()
        let old = Task { try await app.roomsData(.discovery(after: nil), scope: b) }
        await api.wait()
        // A -> B -> A/new session: the old 401 cannot clear the installed credential.
        await api.configure(try session(partition: token(2))); await app.restore()
        await api.fail()
        do { _ = try await old.value; preconditionFailure() } catch { check(error as? RoomsError == .staleScope) }
        check(try store.read() == credential && app.access == .ready && app.roomsScope !== a)
        purge.fail(true)
        do { try await service.signOut(); preconditionFailure() } catch { check(error as? ProductError == .secureStorage) }
        check(try store.read() == nil && store.logoutPending())
        // A new process/service retries failed purge rather than claiming signed out.
        let cold = NativeSessionService(environment: .qa, api: api, store: store, now: { now }, purgeRooms: { try purge.purge() })
        do { _ = try await cold.restore(); preconditionFailure() } catch { check(error as? ProductError == .secureStorage) }
        purge.fail(false)
        check(try await cold.restore().access == .signedOut)
        let before = purge.count
        let noCredential = NativeSessionService(environment: .qa, api: api, store: store, now: { now }, purgeRooms: { try purge.purge() })
        check(try await noCredential.restore().access == .signedOut && purge.count > before)
        print("iOS rooms transport: partition capability, immutable scope, late 401 isolation and cold purge recovery passed")
    }
}
