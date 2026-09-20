import Foundation

private final class IdentityBytes: CredentialBytesStoring, @unchecked Sendable {
    private let lock = NSLock()
    private var data: Data?
    private var fail = false
    func failing(_ value: Bool) { lock.withLock { fail = value } }
    func read() throws -> Data? { lock.withLock { data } }
    func write(_ value: Data) throws { try lock.withLock { if fail { throw ProductError.secureStorage }; data = value } }
    func remove() throws { try lock.withLock { if fail { throw ProductError.secureStorage }; data = nil } }
}
@MainActor private final class IdentityProvider: AppleAuthorizing {
    func authorize(nonce: String, state: String, operation: UUID, validate: @Sendable () throws -> Void) async throws -> AppleProviderMaterial {
        try validate(); return AppleProviderMaterial(code: "test-authorization", token: "test-identity", state: state)
    }
    func cancel(operation: UUID) {}
}
private actor IdentityAPI: AppleIdentityRequesting, SOOPRequesting {
    enum Stage: Sendable { case start, complete, exchange }
    let gateAt: Stage?
    let bytes: IdentityBytes
    let failInstall: Bool
    private var gate: CheckedContinuation<Void, Never>?
    private var waiter: CheckedContinuation<Void, Never>?
    private var arrived = false
    private(set) var counts = [0, 0, 0]
    private(set) var revoked = 0
    init(_ stage: Stage?, bytes: IdentityBytes, failInstall: Bool = false) { gateAt = stage; self.bytes = bytes; self.failInstall = failInstall }
    func wait() async { if arrived { return }; await withCheckedContinuation { waiter = $0 } }
    func release() { gate?.resume(); gate = nil }
    func performApple(_ endpoint: AppleIdentityEndpoint, intent: IdentityIntent, originalCredential: NativeCredential?) async throws -> Data {
        try await performApple(endpoint, intent: intent, originalCredential: originalCredential, admit: {})
    }
    func performApple(_ endpoint: AppleIdentityEndpoint, intent: IdentityIntent, originalCredential: NativeCredential?, admit: @escaping @Sendable () throws -> Void) async throws -> Data {
        let index: Int; let stage: Stage
        switch endpoint { case .start: index = 0; stage = .start; case .complete: index = 1; stage = .complete; case .exchange: index = 2; stage = .exchange }
        if stage == gateAt { await withCheckedContinuation { gate = $0; arrived = true; waiter?.resume(); waiter = nil } }
        try admit(); counts[index] += 1
        precondition(originalCredential == nil && intent == .login)
        switch endpoint {
        case .start:
            return try JSONSerialization.data(withJSONObject: ["transactionId":UUID().uuidString.lowercased(),"nonce":String(repeating:"A",count:43),"state":String(repeating:"A",count:43),"authorizeUrl":NSNull(),"expiresIn":600])
        case .complete: return Data(("{\"code\":\"" + String(repeating:"A",count:43) + "\"}").utf8)
        case .exchange:
            if failInstall { bytes.failing(true) }
            return try AppleCompositionChecks.response()
        }
    }
    func performSOOP(_ request: SOOPRequest, credential: NativeCredential?) async throws -> Data { throw ProductError.unavailable }
    func revokeSOOPCredential(_ credential: NativeCredential) async { revoked += 1 }
}
@main struct AppleCompositionChecks {
    static func check(_ value: Bool) { precondition(value) }
    static let now = Date(timeIntervalSince1970: 2_000_000_000)
    static func response() throws -> Data {
        let date = ISO8601DateFormatter(); date.formatOptions = [.withInternetDateTime,.withFractionalSeconds]
        let expiry = date.string(from: now.addingTimeInterval(604800))
        return try JSONSerialization.data(withJSONObject: ["tokenType":"Bearer","accessToken":String(repeating:"n",count:43),"expiresAt":expiry,"session":[
            "authenticated":true,"account":["userId":"a149a16c-d780-455f-a35e-519e5647a7e2","nickname":"로기","avatarAssetId":NSNull()],
            "soopLinkStatus":"REQUIRED","onboardingState":"SOOP_LINK_REQUIRED","expiresAt":expiry,"accountGeneration":String(repeating:"g",count:43),"capabilities":["chat":false]]])
    }
    @MainActor static func main() async throws {
        for (index, stage) in [IdentityAPI.Stage.start, .complete, .exchange].enumerated() {
            for replacement in [false, true] {
                let directory = FileManager.default.temporaryDirectory.appendingPathComponent("identity-bridge-" + UUID().uuidString)
                defer { try? FileManager.default.removeItem(at: directory) }
                let bytes = IdentityBytes(); let store = NativeCredentialStore(environment: .qa, directory: directory, bytes: bytes)
                let api = IdentityAPI(stage, bytes: bytes)
                let auth = AppleIdentityCoordinator(environment: .qa, store: store, api: api, revoker: api, provider: IdentityProvider(), now: { now })
                let pending = try store.beginApple(intent: .login, proof: SOOPProof.generate(), expected: nil, accountID: nil, serverGeneration: nil, now: now)
                let attempt = SessionAttempt()
                let task = Task { try await auth.authenticate(pending: pending, consentVersion: "2026-09-20", attempt: attempt) }
                await api.wait(); attempt.cancel(); try store.cancelAuth(id: pending.id)
                let newer = replacement ? try store.beginAuth(intent: .login, proof: SOOPProof.generate(), expected: nil, accountID: nil, serverGeneration: nil, now: now) : nil
                if !replacement { try store.setLogoutPending(true) }
                await api.release()
                do { _ = try await task.value; preconditionFailure("stale auth must fail") } catch {}
                let counts = await api.counts
                check(counts == (0..<3).map { $0 < index ? 1 : 0 })
                check(try store.read() == nil)
                if let newer { check(try store.pendingAuth(now: now)?.id == newer.id) }
            }
        }
        let directory = FileManager.default.temporaryDirectory.appendingPathComponent("identity-revoke-" + UUID().uuidString)
        defer { try? FileManager.default.removeItem(at: directory) }
        let bytes = IdentityBytes(); let store = NativeCredentialStore(environment: .qa, directory: directory, bytes: bytes)
        let api = IdentityAPI(nil, bytes: bytes, failInstall: true)
        let auth = AppleIdentityCoordinator(environment: .qa, store: store, api: api, revoker: api, provider: IdentityProvider(), now: { now })
        let pending = try store.beginApple(intent: .login, proof: SOOPProof.generate(), expected: nil, accountID: nil, serverGeneration: nil, now: now)
        do { _ = try await auth.authenticate(pending: pending, consentVersion: "2026-09-20", attempt: SessionAttempt()); preconditionFailure("install must fail") }
        catch { check(error as? ProductError == .secureStorage) }
        check(await api.revoked == 1)
        bytes.failing(false); check(try store.read() == nil)
        let cold = try store.beginApple(intent: .login, proof: SOOPProof.generate(), expected: nil, accountID: nil, serverGeneration: nil, now: now)
        _ = try store.finishAppleStart(id: cold.id, transaction: UUID().uuidString.lowercased(), nonce: String(repeating:"A",count:43), state: String(repeating:"A",count:43), now: now)
        let reopened = NativeCredentialStore(environment: .qa, directory: directory, bytes: bytes)
        check(try reopened.recoverAuth(now: now) != nil); check(try reopened.pendingAuth(now: now) == nil)
        print("iOS Apple composition: six original-proof HTTP admission races, failed-install cleanup/revoke, cold native proof no replay PASS")
    }
}
