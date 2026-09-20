import Foundation

// Always inject bytes. A temporary directory with production Keychain bytes
// could delete the real QA credential via missing-installation recovery.
final class DeletionBytes: CredentialBytesStoring, @unchecked Sendable {
    private let lock = NSLock()
    private var data: Data?
    private var writes = 0
    private var failAt: Int?
    private var readFailure = false
    private var failReadAfterWrite = false
    private var failOneRead = false
    func failRead(_ value: Bool) { lock.withLock { readFailure = value } }
    func failReadAfterNextWrite() { lock.withLock { failReadAfterWrite = true } }
    func failNextWrite(_ offset: Int = 1) { lock.withLock { failAt = writes + offset } }
    func allow() { lock.withLock { failAt = nil } }
    func read() throws -> Data? { try lock.withLock { if readFailure { throw ProductError.secureStorage }; if failOneRead { failOneRead = false; throw ProductError.secureStorage }; return data } }
    func write(_ value: Data) throws { try lock.withLock { writes += 1; if writes == failAt { throw ProductError.secureStorage }; data = value; if failReadAfterWrite { failReadAfterWrite = false; failOneRead = true } } }
    func remove() throws { lock.withLock { data = nil } }
}
final class DeletionPurge: @unchecked Sendable {
    private let lock = NSLock(); private var failure = false; private var value = 0
    private var after: (@Sendable (Int) throws -> Void)?
    func setAfter(_ action: @escaping @Sendable (Int) throws -> Void) { lock.withLock { after = action } }
    func fail(_ value: Bool) { lock.withLock { failure = value } }
    func run() throws { try lock.withLock { value += 1; if failure { throw ProductError.secureStorage }; try after?(value) } }
    var count: Int { lock.withLock { value } }
}
final class DeletionClock: @unchecked Sendable {
    private let lock = NSLock(); private var value: Date
    init(_ value: Date) { self.value = value }
    func read() -> Date { lock.withLock { value } }
    func set(_ value: Date) { lock.withLock { self.value = value } }
}
actor DeletionAPI: NativeRequesting, AccountDeletionRequesting {
    private var admissionGate: DeletionGate?
    func delayAdmission(_ gate: DeletionGate) { admissionGate = gate }
    private var response = AccountDeletionResponse.unknown
    private var session = Data()
    private var blocked = false
    private var pending: CheckedContinuation<AccountDeletionResponse, Never>?
    private var waiter: CheckedContinuation<Void, Never>?
    private(set) var deletes = 0
    private(set) var gets = 0
    func configure(_ session: Data, response: AccountDeletionResponse = .unknown, blocked: Bool = false) { self.session = session; self.response = response; self.blocked = blocked }
    func perform(_ endpoint: NativeEndpoint, credential: NativeCredential) async throws -> Data { gets += 1; return session }
    func performAccountDeletion(credential: NativeCredential, permit: AccountDeletionPermit) async throws -> AccountDeletionResponse {
        if let admissionGate { await admissionGate.enter() }
        try permit.claim(); deletes += 1
        if blocked { return await withCheckedContinuation { pending = $0; waiter?.resume(); waiter = nil } }
        return response
    }
    func wait() async { if pending != nil { return }; await withCheckedContinuation { waiter = $0 } }
    func finish(_ result: AccountDeletionResponse) { pending?.resume(returning: result); pending = nil }
}
actor DeletionGate {
    private var continuation: CheckedContinuation<Void, Never>?
    private var entered: CheckedContinuation<Void, Never>?
    func enter() async { await withCheckedContinuation { continuation = $0; entered?.resume(); entered = nil } }
    func wait() async { if continuation != nil { return }; await withCheckedContinuation { entered = $0 } }
    func release() { continuation?.resume(); continuation = nil }
}
actor DeletionColdAPI: SOOPRequesting {
    let response: Data
    private(set) var exchanges = 0
    init(response: Data) { self.response = response }
    func performSOOP(_ request: SOOPRequest, credential: NativeCredential?) async throws -> Data {
        guard case .exchange = request else { throw SOOPAuthError.invalidRequest }
        exchanges += 1; return response
    }
    func revokeSOOPCredential(_ credential: NativeCredential) async {}
}
@MainActor final class DeletionColdBrowser: SOOPBrowsing {
    func authorize(_ url: URL, environment: NativeEnvironment, operation: UUID, expiresAt: Date, validate: @Sendable () throws -> Void) async throws -> URL { throw CancellationError() }
    func deliver(_ url: URL, operation: UUID) -> Bool { false }
    func cancel(operation: UUID) {}
}
struct DelayedDeletionService: SessionServing, AccountDeletionServing {
    let base: NativeSessionService; let gate: DeletionGate
    var capabilities: SessionCapabilities { base.capabilities }
    func restore() async throws -> SessionSnapshot { try await base.restore() }
    func signIn(_ method: SignInMethod) async throws -> SessionSnapshot { throw ProductError.unavailable }
    func linkSOOP() async throws -> SessionSnapshot { throw ProductError.unavailable }
    func loadProfile() async throws -> AccountProfile { throw ProductError.unavailable }
    func updateProfile(_ update: ProfileUpdate) async throws -> AccountProfile { throw ProductError.unavailable }
    func signOut() async throws { try await base.signOut() }
    func deleteAccount() async throws { throw ProductError.unavailable }
    func cancelAuthentication() async throws -> SessionSnapshot? { try await base.cancelAuthentication() }
    func acceptAuthCallback(_ url: URL) async throws -> SessionSnapshot? { try await base.acceptAuthCallback(url) }
    func resetLocalSession(attempt: SessionAttempt) async throws { await gate.enter(); try await base.resetLocalSession(attempt: attempt) }
    func admitDeletion(_ intent: AccountDeletionIntent) async throws -> AccountDeletionUpdate { await gate.enter(); return try await base.admitDeletion(intent) }
    func deletionStatus(id: UUID) async throws -> AccountDeletionPresentation { try await base.deletionStatus(id: id) }
    func retryDeletionCleanup(id: UUID) async throws -> AccountDeletionUpdate { try await base.retryDeletionCleanup(id: id) }
}
@main struct AccountDeletionChecks {
    static let now = Date(timeIntervalSince1970: 2_000_000_000)
    static let expiry = now.addingTimeInterval(604800)
    static let account = "00000000-0000-4000-8000-000000000001"
    static let secondAccount = "00000000-0000-4000-8000-000000000002"
    static let credential = NativeCredential(token: String(repeating: "a", count: 43), expiresAt: expiry, environment: .qa)
    static let secondCredential = NativeCredential(token: String(repeating: "b", count: 43), expiresAt: expiry, environment: .qa)
    static let receipt = AccountDeletionReceipt(requestId: "00000000-0000-5000-8000-000000000003", status: "blocked")
    static func check(_ value: Bool, line: UInt = #line) { precondition(value, "deletion invariant line \(line)") }
    static func expect(_ error: ProductError, _ action: () throws -> Void) {
        do { try action(); preconditionFailure("Expected typed failure") } catch let actual { check(actual as? ProductError == error) }
    }
    static func session(id: String = account, linked: Bool = true) throws -> Data {
        let formatter = ISO8601DateFormatter(); formatter.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        return try JSONSerialization.data(withJSONObject: ["authenticated": true, "account": ["userId": id, "nickname": "로기", "avatarAssetId": NSNull()], "soopLinkStatus": linked ? "VERIFIED" : "REQUIRED", "onboardingState": linked ? "READY" : "SOOP_LINK_REQUIRED", "expiresAt": formatter.string(from: expiry), "accountGeneration": String(repeating: "g", count: 43), "capabilities": ["chat": linked]])
    }
    static func fixture() throws -> (NativeCredentialStore, DeletionBytes, URL) {
        let url = FileManager.default.temporaryDirectory.appendingPathComponent("deletion-bytes-\(UUID().uuidString)")
        let bytes = DeletionBytes(); let store = NativeCredentialStore(environment: .qa, directory: url, bytes: bytes)
        _ = try store.read(); check(try store.replace(expected: nil, with: credential)); return (store, bytes, url)
    }
    static func intent(_ snapshot: SessionSnapshot, generation: UInt64 = 0) -> AccountDeletionIntent {
        AccountDeletionIntent(id: UUID(), accountID: snapshot.account!.id, accountName: "로기", clientScope: snapshot.clientScope!, generation: generation)
    }
    static func rawIntent() -> AccountDeletionIntent { AccountDeletionIntent(id: UUID(), accountID: account, accountName: "로기", clientScope: UUID(), generation: 0) }
    @MainActor static func finish(_ app: AppSession) async throws {
        let deadline = Date().addingTimeInterval(3)
        while app.busy { check(Date() < deadline); try await Task.sleep(for: .milliseconds(1)) }
    }
    @MainActor static func main() async throws {
        try wire(); try storeLifecycle(); try capacityAndMigration()
        try await commands(); try await recentAuth(); try await failures(); try await acknowledgedCleanupReadFailure(); try await completedCleanupSnapshotReadFailure(); try await expiryAdmission(); try await resetCleanupFailure(); try await staleResetConfirmationAndEntry(); try await coldCallbackDuringReset(); try await UIAndActorHop()
        print("iOS account deletion: exact DTO/duplicate-key/status, protected schema3, capacity/auth headroom, owned dispatch, cold no-replay, receipt failures, recent-auth and stale-account UI fences passed")
    }
    static func wire() throws {
        let request = try AccountDeletionEndpoint.request(environment: .qa, credential: credential)
        check(request.httpMethod == "DELETE" && request.url?.absoluteString == "https://api.qa.rogi.chat/v1/me/account" && request.httpBody == Data("{}".utf8))
        check(request.value(forHTTPHeaderField: "X-Rogi-Client") == "ios" && request.value(forHTTPHeaderField: "Authorization") == "Bearer " + credential.token)
        check(request.value(forHTTPHeaderField: "Cookie") == nil && request.value(forHTTPHeaderField: "Origin") == nil && !request.httpShouldHandleCookies)
        for version in ["4", "5"] {
            let data = Data("{\"requestId\":\"00000000-0000-\(version)000-8000-000000000003\",\"status\":\"blocked\"}".utf8)
            check(AccountDeletionEndpoint.response(data, status: 200).receipt != nil)
            for status in [202,204,400] { check(AccountDeletionEndpoint.response(data, status: status) == .unknown) }
        }
        for text in [#"{"requestId":"00000000-0000-5000-8000-000000000003","status":"blocked","status":"blocked"}"#,
                     #"{"requestId":"00000000-0000-5000-8000-000000000003","status":"blocked","st\u0061tus":"blocked"}"#,
                     #"{"requestId":"00000000-0000-5000-7000-000000000003","status":"blocked"}"#,
                     #"{"requestId":"00000000-0000-5000-8000-000000000003","status":"done"}"#, "{}", "", "[]", "{\"requestId\":\"00000000-0000-5000-8000-000000000003\\n\",\"status\":\"blocked\"}"] {
            check(AccountDeletionEndpoint.response(Data(text.utf8), status: 200) == .unknown)
        }
        let recent = Data(#"{"error":{"code":"RECENT_AUTH_REQUIRED"}}"#.utf8)
        check(AccountDeletionEndpoint.response(recent, status: 403) == .recentAuth)
        for status in [200,401,503] { check(AccountDeletionEndpoint.response(recent, status: status) == .unknown) }
        check(AccountDeletionEndpoint.response(Data(#"{"error":{"code":"RECENT_AUTH_REQUIRED","code":"RECENT_AUTH_REQUIRED"}}"#.utf8), status: 403) == .unknown)
        check(AccountDeletionEndpoint.response(Data(repeating: 32, count: 8193), status: 200) == .unknown)
        check(AccountDeletionEndpoint.response(Data([0xff]), status: 200) == .unknown)
        let permit = AccountDeletionPermit(); try permit.claim(); expect(.sessionChanged) { try permit.claim() }
        let cancelled = AccountDeletionPermit(); cancelled.cancel(); expect(.sessionChanged) { try cancelled.claim() }
        let expired = AccountDeletionPermit(expiresAt: now, now: { now }); expect(.sessionChanged) { try expired.claim() }
    }
    static func storeLifecycle() throws {
        let (store, bytes, directory) = try fixture(); defer { try? FileManager.default.removeItem(at: directory) }
        let oldProof = SOOPProof(verifier: String(repeating: "v", count: 43), state: String(repeating: "s", count: 43))
        let oldPending = try store.beginAuth(intent: .link, proof: oldProof, expected: credential, accountID: account, serverGeneration: String(repeating: "g", count: 43), now: now)
        let original = try store.reserveDeletion(rawIntent(), expected: credential)
        do { try store.installAuth(id: oldPending.id, credential: secondCredential, now: now); preconditionFailure() } catch {}

        expect(.accountDeletionPending) { _ = try store.read() }
        check(try !store.replace(expected: nil, with: secondCredential))
        let claimed = try store.claimDeletion(original)
        let unknown = try store.classifyDeletion(claimed, response: .unknown)
        _ = try store.finishDeletion(unknown)
        check(try store.read() == nil)
        check(try store.replace(expected: nil, with: secondCredential))
        // A delayed exact ACK changes only its own record, not B's credential.
        let late = try store.classifyDeletion(claimed, response: .acknowledged(receipt))
        check(late.receipt == receipt && !late.cleanupPending)
        check(try store.read() == secondCredential)
        expect(.sessionChanged) { try store.verifyDeletionCleanup(late) }
        try store.setLogoutPending(true); try store.completePendingLogout()
        check(try store.deletionRecords().first?.receipt == receipt)
        let cold = NativeCredentialStore(environment: .qa, directory: directory, bytes: bytes)
        check(try cold.deletionRecords().first?.receipt == receipt)
        try bytes.write(Data("corrupt journal".utf8))
        expect(.secureStorage) { _ = try cold.deletionRecords() }
        try cold.resetConfirmed(); check(try cold.deletionRecords().isEmpty)
    }
    static func capacityAndMigration() throws {
        let (store, bytes, directory) = try fixture(); defer { try? FileManager.default.removeItem(at: directory) }
        // Valid schema2 migration preserves its original credential/proof fields.
        var previous = try JSONSerialization.jsonObject(with: bytes.read()!) as! [String: Any]
        previous["schema"] = 2; previous.removeValue(forKey: "deletions")
        try bytes.write(JSONSerialization.data(withJSONObject: previous)); check(try store.read() == credential)
        // Genuine token-only previous format migrates on the next atomic reserve.
        try bytes.write(JSONEncoder().encode(credential)); check(try store.read() == credential)
        for index in 0..<16 {
            let reserved = try store.reserveDeletion(rawIntent(), expected: credential)
            let claimed = try store.claimDeletion(reserved)
            let result = try store.classifyDeletion(claimed, response: index % 2 == 0 ? .unknown : .acknowledged(receipt))
            _ = try store.finishDeletion(result); check(try store.replace(expected: nil, with: credential))
        }
        check(try store.deletionRecords().count == 16)
        expect(.deletionHistoryFull) { _ = try store.reserveDeletion(rawIntent(), expected: credential) }
        // Full journal still leaves room for actual protected auth proof.
        let proof = SOOPProof(verifier: String(repeating: "v", count: 43), state: String(repeating: "s", count: 43))
        let pending = try store.beginAuth(intent: .link, proof: proof, expected: credential, accountID: account, serverGeneration: String(repeating: "g", count: 43), now: now)
        check(try store.pendingAuth(now: now)?.id == pending.id && store.deletionRecords().count == 16)
        try store.cancelAuth(id: pending.id)
        let saved = try bytes.read()!
        var object = try JSONSerialization.jsonObject(with: saved) as! [String: Any]
        object["schema"] = 99; object["token"] = credential.token; object["expiresAt"] = credential.expiresAt.timeIntervalSinceReferenceDate; object["environment"] = "qa"
        try bytes.write(JSONSerialization.data(withJSONObject: object))
        expect(.secureStorage) { _ = try store.read() } // No unknown-schema token fallback.
        try bytes.write(saved)
        for mutation in [0,1,2] {
            var malformed = try JSONSerialization.jsonObject(with: saved) as! [String: Any]
            var records = malformed["deletions"] as! [[String: Any]]
            if mutation == 0 { records[0]["outcome"] = "preparing"; records[0]["phase"] = "finished"; records[0]["cleanupPending"] = false }
            if mutation == 1 { records[0]["quarantine"] = try JSONSerialization.jsonObject(with: JSONEncoder().encode(credential)) }
            if mutation == 2 { records[0]["revision"] = NSNumber(value: UInt64.max) }
            malformed["deletions"] = records; try bytes.write(JSONSerialization.data(withJSONObject: malformed))
            expect(.secureStorage) { _ = try store.deletionRecords() }
        }
        try bytes.write(saved)
    }
    @MainActor static func commands() async throws {
        for response in [AccountDeletionResponse.acknowledged(receipt), .unknown] {
            let (store, bytes, directory) = try fixture(); defer { try? FileManager.default.removeItem(at: directory) }
            let api = DeletionAPI(); let purge = DeletionPurge()
            await api.configure(try session(), response: response, blocked: true)
            let service = NativeSessionService(environment: .qa, api: api, store: store, now: { now }, purgeRooms: { try purge.run() })
            let snapshot = try await service.restore(); let selected = intent(snapshot)
            let observation = Task { try await service.admitDeletion(selected) }
            await api.wait(); observation.cancel()
            check(purge.count > 0)
            do { _ = try await service.admitDeletion(selected); preconditionFailure() } catch {}
            do { try await service.signOut(); preconditionFailure() } catch { check(error as? ProductError == .accountDeletionPending) }
            check(try !store.replace(expected: nil, with: secondCredential))
            await api.finish(response)
            let result = try await observation.value
            check(result.presentation.outcome == response.outcome && !result.presentation.cleanupPending)
            check(await api.deletes == 1)
            check(try store.read() == nil)
            let requests = await api.gets
            let coldStore = NativeCredentialStore(environment: .qa, directory: directory, bytes: bytes)
            let cold = NativeSessionService(environment: .qa, api: api, store: coldStore, now: { now }, purgeRooms: { try purge.run() })
            let recovered = try await cold.restore()
            check(recovered.deletions?.first?.outcome == response.outcome && recovered.access == .signedOut)
            check(await api.deletes == 1); check(await api.gets == requests)
            check(try coldStore.replace(expected: nil, with: secondCredential))
            await api.configure(try session(id: secondAccount))
            let newAccount = try await cold.restore()
            check(newAccount.account?.id == secondAccount)
            let count = purge.count
            _ = try await cold.retryDeletionCleanup(id: selected.id)
            check(try purge.count == count && coldStore.read() == secondCredential)
        }
    }
    @MainActor static func recentAuth() async throws {
        let (store, bytes, directory) = try fixture(); defer { try? FileManager.default.removeItem(at: directory) }
        let api = DeletionAPI(); await api.configure(try session(linked: false), response: .recentAuth)
        let service = NativeSessionService(environment: .qa, api: api, store: store, now: { now })
        let initial = try await service.restore()
        check(initial.access == .linkRequired) // No artificial SOOP prerequisite.
        let result = try await service.admitDeletion(intent(initial))
        check(result.presentation.outcome == .recentAuthRequired && result.snapshot?.account?.id == account)
        check(await api.deletes == 1); check(await api.gets == 2) // Actual live revalidation.
        check(try store.read() == credential)
        let gets = await api.gets
        let cold = NativeSessionService(environment: .qa, api: api, store: NativeCredentialStore(environment: .qa, directory: directory, bytes: bytes), now: { now })
        let reset = try await cold.restore()
        check(try reset.access == .signedOut && store.read() == nil)
        check(await api.gets == gets); check(await api.deletes == 1) // Cold recent403 never GET/DELETE.
        // A historical released marker must not erase or mispublish B.
        check(try store.replace(expected: nil, with: credential))
        await api.configure(try session(), response: .recentAuth)
        let a = try await service.restore(); _ = try await service.admitDeletion(intent(a))
        check(try store.replace(expected: credential, with: secondCredential))
        await api.configure(try session(id: secondAccount))
        let b = try await cold.restore()
        check(try b.account?.id == secondAccount && store.read() == secondCredential)
    }
    @MainActor static func failures() async throws {
        // Every failing mandatory write before HTTP sends nothing.
        for offset in [1,2] {
            let (store, bytes, directory) = try fixture(); defer { try? FileManager.default.removeItem(at: directory) }
            let api = DeletionAPI(); await api.configure(try session())
            let service = NativeSessionService(environment: .qa, api: api, store: store, now: { now })
            let snapshot = try await service.restore(); bytes.failNextWrite(offset)
            do { _ = try await service.admitDeletion(intent(snapshot)); preconditionFailure() } catch {}
            check(await api.deletes == 0)
            bytes.allow()
            let cold = NativeSessionService(environment: .qa, api: api, store: NativeCredentialStore(environment: .qa, directory: directory, bytes: bytes), now: { now })
            _ = try await cold.restore(); check(await api.deletes == 0)
        }
        // Actual protected record survives a mandatory cache cleanup failure.
        do {
            let (store, _, directory) = try fixture(); defer { try? FileManager.default.removeItem(at: directory) }
            let api = DeletionAPI(); let purge = DeletionPurge(); await api.configure(try session())
            let service = NativeSessionService(environment: .qa, api: api, store: store, now: { now }, purgeRooms: { try purge.run() })
            let snapshot = try await service.restore(); let selected = intent(snapshot); purge.fail(true)
            do { _ = try await service.admitDeletion(selected); preconditionFailure() } catch {}
            check(await api.deletes == 0)
            check(try store.deletionRecords().first?.cleanupPending == true)
            purge.fail(false); _ = try await service.retryDeletionCleanup(id: selected.id)
            check(await api.deletes == 0)
        }
        // Lost receipt persistence retains the observed ACK in the owned service.
        do {
            let (store, bytes, directory) = try fixture(); defer { try? FileManager.default.removeItem(at: directory) }
            let api = DeletionAPI(); await api.configure(try session(), blocked: true)
            let service = NativeSessionService(environment: .qa, api: api, store: store, now: { now })
            let app = AppSession(service: service); await app.restore()
            let selected = app.deletionIntent(expectedGeneration: app.generation)!
            app.startDeletion(selected); await api.wait(); bytes.failNextWrite()
            await api.finish(.acknowledged(receipt)); try await finish(app)
            check(app.deletions.last?.outcome == .acknowledged && app.deletions.last?.requestID == receipt.requestId)
            check(app.deletions.last?.cleanupPending == true)
            bytes.allow(); await app.retryDeletionCleanup(id: selected.id)
            check(app.deletions.last?.outcome == .acknowledged && app.deletions.last?.cleanupPending == false)
            check(await api.deletes == 1)
        }
    }
    @MainActor static func acknowledgedCleanupReadFailure() async throws {
        let (store, bytes, directory) = try fixture(); defer { try? FileManager.default.removeItem(at: directory) }
        let api = DeletionAPI(); let purge = DeletionPurge()
        await api.configure(try session(), response: .acknowledged(receipt))
        let service = NativeSessionService(environment: .qa, api: api, store: store, now: { now }, purgeRooms: { try purge.run() })
        let app = AppSession(service: service); await app.restore()
        let before = purge.count
        purge.setAfter { count in if count == before + 2 { bytes.failRead(true); throw ProductError.secureStorage } }
        let selected = app.deletionIntent(expectedGeneration: app.generation)!
        app.startDeletion(selected); try await finish(app)
        check(await api.deletes == 1)
        check(app.deletions.last?.outcome == .acknowledged && app.deletions.last?.requestID == receipt.requestId)
        check(app.deletions.last?.cleanupPending == true) // Never notSent after the ACK.
        bytes.failRead(false); purge.setAfter { _ in }
        await app.retryDeletionCleanup(id: selected.id)
        check(app.deletions.last?.cleanupPending == false)
        app.dismissDeletionPresentation(); check(!app.showDeletionHistory)
        check(try store.deletionRecords().first?.receipt == receipt)
        check(try store.replace(expected: nil, with: secondCredential)); await api.configure(try session(id: secondAccount))
        await app.restore()
        check(app.account?.id == secondAccount && app.visibleDeletions.isEmpty && !app.showDeletionHistory)
        check(try store.deletionRecords().count == 1) // Hiding presentation is not eviction.
    }
    @MainActor static func completedCleanupSnapshotReadFailure() async throws {
        let (store, bytes, directory) = try fixture(); defer { try? FileManager.default.removeItem(at: directory) }
        let api = DeletionAPI(); let purge = DeletionPurge()
        await api.configure(try session(), response: .acknowledged(receipt))
        let service = NativeSessionService(environment: .qa, api: api, store: store, now: { now }, purgeRooms: { try purge.run() })
        let app = AppSession(service: service); await app.restore()
        let before = purge.count
        purge.setAfter { count in if count == before + 2 { bytes.failReadAfterNextWrite() } }
        let selected = app.deletionIntent(expectedGeneration: app.generation)!
        app.startDeletion(selected); try await finish(app)
        check(app.deletions.last?.outcome == .acknowledged && app.deletions.last?.cleanupPending == true)
        check(try store.deletionRecords().last?.cleanupPending == false) // Final commit succeeded, only snapshot read failed.
        let purges = purge.count
        await app.retryDeletionCleanup(id: selected.id)
        check(app.deletions.last?.cleanupPending == false)
        check(try await service.deletionStatus(id: selected.id).cleanupPending == false)
        check(purge.count == purges)
        check(await api.deletes == 1)
    }
    @MainActor static func expiryAdmission() async throws {
        let (store, _, directory) = try fixture(); defer { try? FileManager.default.removeItem(at: directory) }
        let clock = DeletionClock(now); let api = DeletionAPI(); let gate = DeletionGate()
        await api.configure(try session()); await api.delayAdmission(gate)
        let service = NativeSessionService(environment: .qa, api: api, store: store, now: { clock.read() })
        let snapshot = try await service.restore()
        let request = Task { try await service.admitDeletion(intent(snapshot)) }
        await gate.wait(); clock.set(expiry); await gate.release()
        let result = try await request.value
        check(result.presentation.outcome == .unknown)
        check(await api.deletes == 0) // Last HTTP actor permit refuses expired original token.
        check(try store.read() == nil)
    }
    @MainActor static func resetCleanupFailure() async throws {
        let (store, _, directory) = try fixture(); defer { try? FileManager.default.removeItem(at: directory) }
        let record = try store.reserveDeletion(rawIntent(), expected: credential)
        let claimed = try store.claimDeletion(record)
        let acknowledged = try store.classifyDeletion(claimed, response: .acknowledged(receipt))
        _ = try store.finishDeletion(acknowledged)
        let purge = DeletionPurge(); purge.fail(true); let api = DeletionAPI()
        let service = NativeSessionService(environment: .qa, api: api, store: store, now: { now }, purgeRooms: { try purge.run() })
        do { try await service.resetLocalSession(); preconditionFailure() } catch {}
        check(try store.deletionRecords().first?.receipt == receipt)
        purge.fail(false); try await service.resetLocalSession()
        check(try store.deletionRecords().isEmpty)
        check(await api.deletes == 0)
    }
    @MainActor static func coldCallbackDuringReset() async throws {
        let (store, bytes, directory) = try fixture(); defer { try? FileManager.default.removeItem(at: directory) }
        let reserved = try store.reserveDeletion(rawIntent(), expected: credential)
        let claimed = try store.claimDeletion(reserved)
        let acknowledged = try store.classifyDeletion(claimed, response: .acknowledged(receipt))
        _ = try store.finishDeletion(acknowledged)
        let proof = SOOPProof(verifier: String(repeating: "v", count: 43), state: String(repeating: "s", count: 43))
        let pending = try store.beginAuth(intent: .login, proof: proof, expected: nil, accountID: nil, serverGeneration: nil, now: now)
        _ = try store.finishAuthStart(id: pending.id, response: SOOPStartResponse(transactionId: UUID().uuidString.lowercased(), authorizeUrl: URL(string: "https://api.qa.rogi.chat/v1/auth/native/soop/launch?request=" + String(repeating: "r", count: 43))!, expiresIn: 600), now: now)
        let reopened = NativeCredentialStore(environment: .qa, directory: directory, bytes: bytes)
        let sessionData = try session(id: secondAccount)
        let object = try JSONSerialization.jsonObject(with: sessionData) as! [String: Any]
        let exchange = try JSONSerialization.data(withJSONObject: ["tokenType": "Bearer", "accessToken": secondCredential.token, "expiresAt": object["expiresAt"]!, "session": object])
        let authAPI = DeletionColdAPI(response: exchange)
        let auth = SOOPAuthCoordinator(environment: .qa, store: reopened, api: authAPI, browser: DeletionColdBrowser(), now: { now })
        let api = DeletionAPI(); let gate = DeletionGate()
        let service = NativeSessionService(environment: .qa, api: api, store: reopened, now: { now }, auth: auth)
        let app = AppSession(service: DelayedDeletionService(base: service, gate: gate))
        await app.restore(); check(app.access == .signedOut && app.deletions.count == 1)
        check(try reopened.pendingAuth(now: now)?.id == pending.id)
        let reset = Task { await app.resetLocalSession(expectedGeneration: app.generation) }
        await gate.wait()
        let callback = URL(string: "https://qa.rogi.chat/mobile/auth/complete?code=" + String(repeating: "c", count: 43) + "&state=" + proof.state)!
        await app.acceptAuthCallback(callback)
        check(app.access == .restoring && app.account == nil)
        check(await authAPI.exchanges == 0)
        check(try reopened.pendingAuth(now: now)?.id == pending.id)
        await gate.release(); await reset.value
        await app.restore() // Deferred return must not replay after reset completion.
        check(app.access == .signedOut && app.account == nil)
        check(await authAPI.exchanges == 0)
        check(try reopened.read() == nil && reopened.deletionRecords().isEmpty)
        check(try reopened.pendingAuth(now: now) == nil)
        check(await api.deletes == 0)
    }
    @MainActor static func staleResetConfirmationAndEntry() async throws {
        let (store, _, directory) = try fixture(); defer { try? FileManager.default.removeItem(at: directory) }
        let reserved = try store.reserveDeletion(rawIntent(), expected: credential)
        let claimed = try store.claimDeletion(reserved)
        let acknowledged = try store.classifyDeletion(claimed, response: .acknowledged(receipt))
        _ = try store.finishDeletion(acknowledged)
        check(try store.replace(expected: nil, with: credential))
        let api = DeletionAPI(); await api.configure(try session())
        let purge = DeletionPurge(); let gate = DeletionGate()
        let service = NativeSessionService(environment: .qa, api: api, store: store, now: { now }, purgeRooms: { try purge.run() })
        let app = AppSession(service: DelayedDeletionService(base: service, gate: gate))
        await app.restore(); let confirmation = app.generation
        let oldReset = Task { await app.resetLocalSession(expectedGeneration: confirmation) }
        await gate.wait()
        await app.cancelAuthentication() // Cancels the original reset's immutable attempt before service entry.
        check(try store.replace(expected: credential, with: secondCredential))
        await api.configure(try session(id: secondAccount)); await app.restore()
        check(app.account?.id == secondAccount)
        let count = purge.count
        await gate.release(); await oldReset.value
        check(app.account?.id == secondAccount && purge.count == count)
        check(try store.read() == secondCredential && store.deletionRecords().first?.receipt == receipt)
        // An old visible confirmation is refused before clearing the new UI or entering the service.
        await app.resetLocalSession(expectedGeneration: confirmation)
        check(app.account?.id == secondAccount && purge.count == count)
        check(try store.read() == secondCredential && store.deletionRecords().count == 1)
        check(await api.deletes == 0)
    }
    @MainActor static func UIAndActorHop() async throws {
        let (store, _, directory) = try fixture(); defer { try? FileManager.default.removeItem(at: directory) }
        let api = DeletionAPI(); await api.configure(try session())
        let service = NativeSessionService(environment: .qa, api: api, store: store, now: { now })
        let gate = DeletionGate(); let app = AppSession(service: DelayedDeletionService(base: service, gate: gate))
        await app.restore(); let old = app.deletionIntent(expectedGeneration: app.generation)!
        check(try store.replace(expected: credential, with: secondCredential)); await api.configure(try session(id: secondAccount))
        await app.restore(); let bGeneration = app.generation
        app.startDeletion(old)
        check(app.account?.id == secondAccount && app.generation == bGeneration && !app.showDeletionHistory)
        check(await api.deletes == 0)
        // Original UI check passes, then service scope changes during actor entry.
        let selected = app.deletionIntent(expectedGeneration: app.generation)!
        app.startDeletion(selected); await gate.wait()
        _ = try await service.restore() // Rotates service-issued clientScope for the same B.
        await gate.release(); try await finish(app)
        check(await api.deletes == 0)
        check(try store.read() == secondCredential)
        app.dismissDeletionPresentation(); check(!app.showDeletionHistory)
        await app.restore()
        check(app.account?.id == secondAccount && app.visibleDeletions.isEmpty && !app.showDeletionHistory)
    }
}
