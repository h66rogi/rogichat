import Foundation

final class AuthBytes: CredentialBytesStoring, @unchecked Sendable {
    private let lock = NSLock()
    private var data: Data?
    private var fail = false
    func failWrites(_ value: Bool) { lock.withLock { fail = value } }
    func read() throws -> Data? { lock.withLock { data } }
    func write(_ data: Data) throws { try lock.withLock { if fail { throw ProductError.secureStorage }; self.data = data } }
    func remove() throws { try lock.withLock { if fail { throw ProductError.secureStorage }; data = nil } }
}
@MainActor final class AuthBrowser: SOOPBrowsing {
    var current: UUID?
    private var continuation: CheckedContinuation<URL, any Error>?
    private var waiter: CheckedContinuation<Void, Never>?
    func authorize(_ url: URL, environment: NativeEnvironment, operation: UUID, validate: @Sendable () throws -> Void) async throws -> URL {
        try validate()
        if let current { cancel(operation: current) }
        current = operation
        return try await withCheckedThrowingContinuation { continuation in
            self.continuation = continuation; waiter?.resume(); waiter = nil
        }
    }
    func wait() async { if continuation != nil { return }; await withCheckedContinuation { waiter = $0 } }
    func deliver(_ url: URL, operation: UUID) -> Bool {
        guard current == operation, let continuation else { return false }
        self.continuation = nil; current = nil; continuation.resume(returning: url); return true
    }
    func cancel(operation: UUID) {
        guard current == operation else { return }
        let pending = continuation; continuation = nil; current = nil; pending?.resume(throwing: CancellationError())
    }
}
actor AuthAPI: SOOPRequesting, NativeRequesting {
    func perform(_ endpoint: NativeEndpoint, credential: NativeCredential) async throws -> Data {
        try await AuthNativeAPI().perform(endpoint,credential:credential)
    }
    private(set) var starts = 0
    private(set) var exchanges = 0
    private(set) var revoked: [NativeCredential] = []
    private var held: CheckedContinuation<Data, any Error>?
    private var waiter: CheckedContinuation<Void, Never>?
    var error: SOOPAuthError?
    func setError(_ value: SOOPAuthError?) { error = value }
    func performSOOP(_ request: SOOPRequest, credential: NativeCredential?) async throws -> Data {
        if let error { throw error }
        switch request {
        case .start(let start):
            starts += 1
            precondition(start.intent == .login ? credential == nil : credential != nil)
            return try JSONSerialization.data(withJSONObject: ["transactionId": UUID().uuidString.lowercased(), "authorizeUrl": "https://api.qa.rogi.chat/v1/auth/native/soop/launch?request=" + String(repeating: "r", count: 43), "expiresIn":600])
        case .password, .exchange:
            exchanges += 1
            return try await withCheckedThrowingContinuation { held = $0; waiter?.resume(); waiter = nil }
        }
    }
    func wait() async { if held != nil { return }; await withCheckedContinuation { waiter = $0 } }
    func finish(_ result: Result<Data, any Error>) { let c = held; held = nil; c?.resume(with: result) }
    func revokeSOOPCredential(_ credential: NativeCredential) async { revoked.append(credential) }
}
// A scheduler-controlled coordinator hop reproduces cancellation before actor entry
// and after protected installation, without timing sleeps or platform UI.
actor GatedAuth: SOOPAuthenticating {
    let wrapped: SOOPAuthCoordinator
    let afterInstall: Bool
    private var gate: CheckedContinuation<Void, Never>?
    private var arrived = false
    private var holdClose = false
    private var closing = false
    private var closeGate: CheckedContinuation<Void, Never>?
    private var closeWaiter: CheckedContinuation<Void, Never>?
    private var waiter: CheckedContinuation<Void, Never>?
    init(_ wrapped: SOOPAuthCoordinator, afterInstall: Bool = false) { self.wrapped = wrapped; self.afterInstall = afterInstall }
    private func pause() async {
        await withCheckedContinuation { gate = $0; arrived = true; waiter?.resume(); waiter = nil }
    }
    func wait() async { if arrived { return }; await withCheckedContinuation { waiter = $0 } }
    func release() { gate?.resume(); gate = nil }
    func authenticate(pending: SOOPPending, consentVersion: String?, attempt: SessionAttempt) async throws -> SOOPAuthResult {
        if !afterInstall { await pause() }
        let result = try await wrapped.authenticate(pending: pending, consentVersion: consentVersion, attempt: attempt)
        if afterInstall { await pause() }
        return result
    }
    func accept(_ url: URL) async throws -> SOOPAuthResult? { try await wrapped.accept(url) }
    func holdClosing() { holdClose = true }
    func waitClosing() async { if closing { return }; await withCheckedContinuation { closeWaiter = $0 } }
    func releaseClosing() { closeGate?.resume(); closeGate = nil; holdClose = false }
    func closeBrowser() async {
        if holdClose { await withCheckedContinuation { closeGate = $0; closing = true; closeWaiter?.resume(); closeWaiter = nil } }
        await wrapped.closeBrowser()
    }
    func discard(_ result: SOOPAuthResult) async { await wrapped.discard(result) }
}
final class AuthClock: @unchecked Sendable {
    private let lock = NSLock()
    private var value: Date
    init(_ value: Date) { self.value = value }
    func read() -> Date { lock.withLock { value } }
    func set(_ value: Date) { lock.withLock { self.value = value } }
}
struct AuthNativeAPI: NativeRequesting {
    var restricted = false
    func perform(_ endpoint: NativeEndpoint, credential: NativeCredential) async throws -> Data {
        if case .logout = endpoint { return Data() }
        let object = try JSONSerialization.jsonObject(with: SOOPAuthChecks.returned(credential.token)) as! [String: Any]
        var session = object["session"] as! [String: Any]
        if restricted { session["soopLinkStatus"] = "REQUIRED"; session["onboardingState"] = "SOOP_LINK_REQUIRED"; session["capabilities"] = ["chat": false] }
        return try JSONSerialization.data(withJSONObject: session)
    }
}
@main struct SOOPAuthChecks {
    static let now = Date(timeIntervalSince1970: 2_000_000_000)
    static let accountID = "a149a16c-d780-455f-a35e-519e5647a7e2"
    static let proof = SOOPProof(verifier: String(repeating: "v", count: 43), state: String(repeating: "s", count: 43))
    static let old = NativeCredential(token: String(repeating: "o", count: 43), expiresAt: now.addingTimeInterval(604800), environment: .qa)
    static func check(_ value: Bool, line: UInt = #line) { precondition(value, "test line \(line)") }
    static func callback(_ state: String, code: String = String(repeating: "c", count: 43)) -> URL { URL(string: "https://qa.rogi.chat/mobile/auth/complete?code=\(code)&state=\(state)")! }
    static func returned(_ token: String = String(repeating: "n", count: 43), id: String = accountID) throws -> Data {
        let formatter = ISO8601DateFormatter(); formatter.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        let expiry = formatter.string(from: old.expiresAt)
        return try JSONSerialization.data(withJSONObject: ["tokenType":"Bearer", "accessToken":token, "expiresAt":expiry, "session":[
            "authenticated":true, "account":["userId":id,"nickname":"로기","avatarAssetId":NSNull()], "soopLinkStatus":"VERIFIED",
            "onboardingState":"READY", "expiresAt":expiry, "accountGeneration":String(repeating:"g",count:43), "capabilities":["chat":true]]])
    }
    @MainActor static func passwordChecks() async throws {
        let input = PasswordInput(loginID:"reviewer.real",password:"a correct password",newPassword:nil)
        check(PasswordInput.valid(String(repeating:"😀",count:12)))
        check(!PasswordInput.valid(String(repeating:"😀",count:65)))
        check(!PasswordInput.valid("a correct password\n"))
        check(!input.description.contains(input.password))
        let request = try SOOPRequest.password(input).request(environment:.qa,credential:nil)
        check(request.url?.path == "/v1/auth/password/login" && request.value(forHTTPHeaderField:"X-Rogi-Client") == "ios")
        check(request.value(forHTTPHeaderField:"Authorization") == nil && request.value(forHTTPHeaderField:"Cookie") == nil && request.value(forHTTPHeaderField:"Origin") == nil)
        check(!request.httpShouldHandleCookies)
        let (store,bytes,directory) = try fixture(); defer { try? FileManager.default.removeItem(at:directory) }
        let api = AuthAPI(); let browser = AuthBrowser()
        let auth = SOOPAuthCoordinator(environment:.qa,store:store,api:api,browser:browser,now:{now})
        let service = NativeSessionService(environment:.qa,api:api,store:store,now:{now},auth:auth)
        _ = try await service.restore()
        let attempt = SessionAttempt()
        let login = Task { try await service.password(input,attempt:attempt) }
        await api.wait()
        let pending = try store.pendingAuth(now:now)
        check(pending?.provider == "password" && pending?.phase == .exchanging && pending?.transactionID == nil)
        await api.finish(.success(try returned(String(repeating:"p",count:43))))
        let snapshot = try await login.value
        check(snapshot.access == .ready); try snapshot.publication?.acknowledge()
        check(try store.read()?.token == String(repeating:"p",count:43))
        let change = PasswordInput(loginID:nil,password:"a correct password",newPassword:"a replacement password")
        let rotation = Task { try await service.password(change,attempt:SessionAttempt()) }
        await api.wait(); await api.finish(.success(try returned(String(repeating:"q",count:43))))
        let rotated = try await rotation.value; try rotated.publication?.acknowledge()
        check(try store.read()?.token == String(repeating:"q",count:43))
        try await service.signOut()
        let cancelled = Task { try await service.password(input,attempt:SessionAttempt()) }
        await api.wait(); _ = try await service.cancelAuthentication()
        let late = String(repeating:"z",count:43); await api.finish(.success(try returned(late)))
        do { _ = try await cancelled.value; preconditionFailure("late password result must fail") } catch {}
        check(try store.read() == nil); check(await api.revoked.contains { $0.token == late })
        // A real protected pending password attempt cannot be replayed on cold restore.
        _ = try store.beginPassword(expected:nil,accountID:nil,serverGeneration:nil,now:now)
        let reopened = NativeCredentialStore(environment:.qa,directory:directory,bytes:bytes)
        check(try reopened.recoverAuth(now:now) != nil); check(try reopened.pendingAuth(now:now) == nil)
        let failed = Task { try await service.password(input,attempt:SessionAttempt()) }
        await api.wait(); bytes.failWrites(true); await api.finish(.success(try returned(String(repeating:"s",count:43))))
        do { _ = try await failed.value; preconditionFailure("failed password install must fail") } catch {}
        bytes.failWrites(false); check(try store.read() == nil)
        print("iOS password: native headers, protected rotation, late cancellation revoke, cold no replay and failed install passed")
    }
    static func fixture() throws -> (NativeCredentialStore, AuthBytes, URL) {
        let directory = FileManager.default.temporaryDirectory.appendingPathComponent("rogichat-auth-check-\(UUID().uuidString)")
        let bytes = AuthBytes(); let store = NativeCredentialStore(environment: .qa, directory: directory, bytes: bytes)
        _ = try store.read(); return (store, bytes, directory)
    }
    static func expect(_ error: any Error, _ body: () throws -> Void) {
        do { try body(); preconditionFailure("expected failure") }
        catch let actual { check(String(describing: actual) == String(describing: error)) }
    }
    @MainActor static func main() async throws {
        try await passwordChecks()
        try contract(); try persistence(); try await flows(); try await fences(); try await scopedErrors()
        print("iOS SOOP: exact headers/callback/PKCE, persisted proof epoch, cold return, one-shot exchange, cancel/newer-account/late-success, consent and failed-install recovery passed")
    }
    static func contract() throws {
        let generated = try SOOPProof.generate()
        check(generated.valid && generated.challenge.count == 43 && generated.verifier != generated.state)
        let start = SOOPStart(intent:.login,codeChallenge:proof.challenge,returnState:proof.state,termsVersion:"2026-09-20")
        let request = try SOOPRequest.start(start).request(environment:.qa,credential:nil)
        check(request.value(forHTTPHeaderField:"Authorization") == nil && request.value(forHTTPHeaderField:"X-Rogi-Client") == "ios")
        for field in ["Origin","Cookie","X-CSRF-Token"] { check(request.value(forHTTPHeaderField:field) == nil) }
        let input = try JSONSerialization.jsonObject(with:request.httpBody!) as! [String:Any]
        check(input["codeVerifier"] == nil && input["termsVersion"] as? String == "2026-09-20")
        let link = SOOPStart(intent:.link,codeChallenge:proof.challenge,returnState:proof.state,termsVersion:nil)
        let linked = try SOOPRequest.start(link).request(environment:.qa,credential:old)
        check(linked.value(forHTTPHeaderField:"Authorization") == "Bearer " + old.token)
        let linkedBody = try JSONSerialization.jsonObject(with:linked.httpBody!) as! [String:Any]
        check(linkedBody["termsVersion"] == nil)
        expect(SOOPAuthError.invalidRequest) { _ = try SOOPRequest.start(start).request(environment:.qa,credential:old) }
        check(try SOOPCallback.parse(callback(proof.state), environment:.qa,expectedState:proof.state) == .completion(String(repeating:"c",count:43)))
        for url in [callback(proof.state).absoluteString + "&code=duplicate", callback(proof.state).absoluteString + "&extra=x",
                    callback(proof.state).absoluteString.replacingOccurrences(of:"qa.rogi.chat",with:"rogi.chat"),
                    callback(proof.state).absoluteString.replacingOccurrences(of:"/mobile/auth/complete",with:"/mobile/auth/%63omplete"),
                    callback(proof.state).absoluteString + "#fragment", "rogichat://auth/callback?state=" + proof.state] {
            expect(ProductError.invalidResponse) { _ = try SOOPCallback.parse(URL(string:url)!, environment:.qa,expectedState:proof.state) }
        }
        let failure = SOOPAuthError.response(Data(#"{"error":{"code":"LINK_SESSION_CHANGED"}}"#.utf8),status:401)
        check(failure as? SOOPAuthError == .sessionChanged)
        check(SOOPAuthError.response(Data(),status:404) as? SOOPAuthError == .unavailable)
        let decoded = try JSONDecoder().decode(SOOPExchangeResponse.self,from:returned())
        let (_,snapshot) = try decoded.validated(environment:.qa,now:now)
        check(snapshot.account?.signInMethod == nil)
        var response = try JSONSerialization.jsonObject(with: returned()) as! [String: Any]
        var session = response["session"] as! [String: Any]
        // Additive partition is optional; present values must be canonical 32 bytes.
        session["accountPartition"] = String(repeating: "A", count: 43); response["session"] = session
        _ = try JSONDecoder().decode(SOOPExchangeResponse.self, from: JSONSerialization.data(withJSONObject: response)).validated(environment: .qa, now: now)
        for bad: Any in [NSNull(), "", String(repeating: "A", count: 42) + "B", String(repeating: "A", count: 44)] {
            session["accountPartition"] = bad; response["session"] = session
            expect(ProductError.invalidResponse) { _ = try JSONDecoder().decode(SOOPExchangeResponse.self, from: JSONSerialization.data(withJSONObject: response)).validated(environment: .qa, now: now) }
        }
    }
    static func persistence() throws {
        let (store,bytes,directory) = try fixture(); defer { try? FileManager.default.removeItem(at:directory) }
        // Previous token-only storage is read without losing a real account.
        try bytes.write(JSONEncoder().encode(old)); check(try store.read() == old)
        let pending = try store.beginAuth(intent:.link,proof:proof,expected:old,accountID:accountID,serverGeneration:String(repeating:"g",count:43),now:now)
        let start = SOOPStartResponse(transactionId:UUID().uuidString.lowercased(),authorizeUrl:URL(string:"https://api.qa.rogi.chat/v1/auth/native/soop/launch?request=" + String(repeating:"r",count:43))!,expiresIn:600)
        _ = try store.finishAuthStart(id:pending.id,response:start,now:now)
        let reopened = NativeCredentialStore(environment:.qa,directory:directory,bytes:bytes)
        check(try reopened.pendingAuth(now:now)?.id == pending.id)
        let marker = try String(contentsOf:directory.appendingPathComponent("installation.json"),encoding:.utf8)
        check(!marker.contains(proof.verifier) && !marker.contains(old.token))
        _ = try reopened.claimAuthExchange(id:pending.id,now:now)
        expect(SOOPAuthError.failed) { _ = try reopened.claimAuthExchange(id:pending.id,now:now) }
        check(try reopened.recoverAuth(now:now) != nil)
        check(try reopened.pendingAuth(now:now) == nil && reopened.read() == old)
        let expired = try store.beginAuth(intent:.link,proof:proof,expected:old,accountID:accountID,serverGeneration:String(repeating:"g",count:43),now:now)
        expect(SOOPAuthError.expired) { _ = try store.finishAuthStart(id:expired.id,response:start,now:now.addingTimeInterval(60)) }
        check(try store.recoverAuth(now:now.addingTimeInterval(600)) != nil)
        let failedCancel = try store.beginAuth(intent:.link,proof:proof,expected:old,accountID:accountID,serverGeneration:String(repeating:"g",count:43),now:now)
        _ = try store.finishAuthStart(id:failedCancel.id,response:start,now:now)
        bytes.failWrites(true)
        expect(ProductError.secureStorage) { try store.cancelAuth(id:failedCancel.id) }
        let afterCancelFailure = NativeCredentialStore(environment:.qa,directory:directory,bytes:bytes)
        expect(ProductError.secureStorage) { _ = try afterCancelFailure.pendingAuth(now:now) }
        bytes.failWrites(false)
        check(try afterCancelFailure.pendingAuth(now:now) == nil && afterCancelFailure.read() == old)
        try bytes.write(Data("corrupt".utf8))
        expect(ProductError.secureStorage) { _ = try store.read() }
        try store.resetConfirmed(); check(try store.read() == nil)
        for acknowledged in [false, true] {
            let p = try store.beginAuth(intent:.login,proof:proof,expected:nil,accountID:nil,serverGeneration:nil,now:now)
            _ = try store.finishAuthStart(id:p.id,response:start,now:now)
            _ = try store.claimAuthExchange(id:p.id,now:now)
            try store.installAuth(id:p.id,credential:old,now:now)
            if acknowledged { try store.acknowledgeAuth(id:p.id,credential:old) }
            let afterCrash = NativeCredentialStore(environment:.qa,directory:directory,bytes:bytes)
            _ = try afterCrash.recoverAuth(now:now)
            check(try afterCrash.read() == (acknowledged ? old : nil))
            _ = try store.replace(expected:try store.read(),with:nil)
        }
    }
    @MainActor static func flows() async throws {
        let (store,bytes,directory) = try fixture(); defer { try? FileManager.default.removeItem(at:directory) }
        let api = AuthAPI(); let browser = AuthBrowser()
        let auth = SOOPAuthCoordinator(environment:.qa,store:store,api:api,browser:browser,now:{now})
        let reserved = try store.beginAuth(intent:.login,proof:proof,expected:nil,accountID:nil,serverGeneration:nil,now:now)
        let login = Task { try await auth.authenticate(pending:reserved,consentVersion:"2026-09-20") }
        await browser.wait()
        let pending = try store.pendingAuth(now:now)!
        do { _ = try await auth.accept(callback(String(repeating:"x",count:43))); preconditionFailure("wrong state") } catch ProductError.invalidResponse {}
        check(try store.pendingAuth(now:now)?.id == pending.id)
        check(try await auth.accept(callback(pending.proof.state)) == nil)
        await api.wait()
        // Duplicate warm delivery cannot issue another exchange.
        check(try await auth.accept(callback(pending.proof.state)) == nil)
        await api.finish(.success(try returned()))
        let result = try await login.value
        check(try store.read() == result.credential && store.pendingAuth(now:now) == nil)
        check(await api.exchanges == 1)
        _ = try store.replace(expected:result.credential,with:nil)
        let reservedLate = try store.beginAuth(intent:.login,proof:proof,expected:nil,accountID:nil,serverGeneration:nil,now:now)
        let late = Task { try await auth.authenticate(pending:reservedLate,consentVersion:"2026-09-20") }
        await browser.wait()
        let cancelled = try store.pendingAuth(now:now)!
        _ = try await auth.accept(callback(cancelled.proof.state)); await api.wait()
        try await auth.cancel()
        // A newer account wins even if the previous exchange succeeds afterwards.
        _ = try store.replace(expected:nil,with:old)
        await api.finish(.success(try returned()))
        do { _ = try await late.value; preconditionFailure("late install") } catch {}
        check(try store.read() == old)
        check(await api.revoked.count == 1)
        _ = try store.replace(expected:old,with:nil)
        // Persisted browser proof can finish in a new coordinator after process death.
        let cold = try store.beginAuth(intent:.login,proof:proof,expected:nil,accountID:nil,serverGeneration:nil,now:now)
        let start = SOOPStartResponse(transactionId:UUID().uuidString.lowercased(),authorizeUrl:URL(string:"https://api.qa.rogi.chat/v1/auth/native/soop/launch?request=" + String(repeating:"r",count:43))!,expiresIn:600)
        _ = try store.finishAuthStart(id:cold.id,response:start,now:now)
        let reopened = NativeCredentialStore(environment:.qa,directory:directory,bytes:bytes)
        let restored = SOOPAuthCoordinator(environment:.qa,store:reopened,api:api,browser:browser,now:{now})
        let coldReturn = Task { try await restored.accept(callback(proof.state)) }
        await api.wait(); bytes.failWrites(true)
        await api.finish(.success(try returned()))
        do { _ = try await coldReturn.value; preconditionFailure("failed install must not succeed") } catch ProductError.secureStorage {}
        bytes.failWrites(false)
        check(try store.read() == nil)
        check(await api.revoked.count == 2)
        _ = try reopened.recoverAuth(now:now)
        // Fixed terms errors do not replace or erase an existing account.
        _ = try store.replace(expected:nil,with:old)
        await api.setError(.terms)
        let linkReservation = try store.beginAuth(intent:.link,proof:proof,expected:old,accountID:accountID,serverGeneration:String(repeating:"g",count:43),now:now)
        do { _ = try await auth.authenticate(pending:linkReservation,consentVersion:nil); preconditionFailure("terms") } catch SOOPAuthError.terms {}
        check(try store.read() == old)
    }
    @MainActor static func fences() async throws {
        for logout in [false, true] {
            let (store,_,directory) = try fixture(); defer { try? FileManager.default.removeItem(at:directory) }
            let api = AuthAPI(); let browser = AuthBrowser()
            let coordinator = SOOPAuthCoordinator(environment:.qa,store:store,api:api,browser:browser,now:{now})
            let gate = GatedAuth(coordinator)
            let service = NativeSessionService(environment:.qa,api:AuthNativeAPI(),store:store,now:{now},auth:gate)
            let flow = Task { try await service.signInSOOP(consentVersion:"2026-09-20") }
            await gate.wait()
            check(try store.pendingAuth(now:now) != nil)
            if logout { try await service.signOut() } else { _ = try await service.cancelAuthentication() }
            await gate.release()
            do { _ = try await flow.value; preconditionFailure("cancelled reservation") } catch {}
            check(await api.starts == 0); check(await api.exchanges == 0)
            check(try store.read() == nil && store.pendingAuth(now:now) == nil)
            check(try await service.restore().access == .signedOut)
        }
        // Cancellation at the UI-to-service hop is checked before reserving proof.
        do {
            let (store,_,directory) = try fixture(); defer { try? FileManager.default.removeItem(at:directory) }
            let api = AuthAPI(); let browser = AuthBrowser()
            let coordinator = SOOPAuthCoordinator(environment:.qa,store:store,api:api,browser:browser,now:{now})
            let service = NativeSessionService(environment:.qa,api:AuthNativeAPI(),store:store,now:{now},auth:coordinator)
            let attempt = SessionAttempt(); attempt.cancel()
            do { _ = try await service.beginSOOP(consentVersion:"2026-09-20",attempt:attempt); preconditionFailure("cancelled UI hop") } catch is CancellationError {}
            check(try store.pendingAuth(now:now) == nil)
            check(await api.starts == 0)
        }
        // Cancellation after install but before service publication clears and revokes only that token.
        do {
            let (store,_,directory) = try fixture(); defer { try? FileManager.default.removeItem(at:directory) }
            let api = AuthAPI(); let browser = AuthBrowser()
            let coordinator = SOOPAuthCoordinator(environment:.qa,store:store,api:api,browser:browser,now:{now})
            let gate = GatedAuth(coordinator,afterInstall:true)
            let service = NativeSessionService(environment:.qa,api:AuthNativeAPI(),store:store,now:{now},auth:gate)
            let flow = Task { try await service.signInSOOP(consentVersion:"2026-09-20") }
            await browser.wait(); let pending = try store.pendingAuth(now:now)!
            _ = try await coordinator.accept(callback(pending.proof.state)); await api.wait()
            await api.finish(.success(try returned())); await gate.wait()
            check(try store.read() != nil)
            _ = try await service.cancelAuthentication(); await gate.release()
            do { _ = try await flow.value; preconditionFailure("cancelled installed result") } catch {}
            check(try store.read() == nil); check(await api.revoked.count == 1)
        }
        // UI acknowledgement itself cannot run after cancellation, even after service returns.
        do {
            let (store,_,directory) = try fixture(); defer { try? FileManager.default.removeItem(at:directory) }
            let api = AuthAPI(); let browser = AuthBrowser()
            let coordinator = SOOPAuthCoordinator(environment:.qa,store:store,api:api,browser:browser,now:{now})
            let service = NativeSessionService(environment:.qa,api:AuthNativeAPI(),store:store,now:{now},auth:coordinator)
            let attempt = SessionAttempt()
            let flow = Task { try await service.beginSOOP(consentVersion:"2026-09-20",attempt:attempt) }
            await browser.wait(); let pending = try store.pendingAuth(now:now)!
            _ = try await coordinator.accept(callback(pending.proof.state)); await api.wait()
            await api.finish(.success(try returned())); let snapshot = try await flow.value
            attempt.cancel()
            do { try snapshot.publication?.acknowledge(); preconditionFailure("cancelled publication") } catch is CancellationError {}
            await snapshot.publication?.discard()
            check(try store.read() == nil); check(await api.revoked.count == 1)
        }
        // A cold completion losing to a fresh user login cannot replace its UI/error state.
        do {
            let (store,_,directory) = try fixture(); defer { try? FileManager.default.removeItem(at:directory) }
            let pending = try store.beginAuth(intent:.login,proof:proof,expected:nil,accountID:nil,serverGeneration:nil,now:now)
            let start = SOOPStartResponse(transactionId:UUID().uuidString.lowercased(),authorizeUrl:URL(string:"https://api.qa.rogi.chat/v1/auth/native/soop/launch?request=" + String(repeating:"r",count:43))!,expiresIn:600)
            _ = try store.finishAuthStart(id:pending.id,response:start,now:now)
            let api = AuthAPI(); let browser = AuthBrowser()
            let coordinator = SOOPAuthCoordinator(environment:.qa,store:store,api:api,browser:browser,now:{now})
            let service = NativeSessionService(environment:.qa,api:AuthNativeAPI(),store:store,now:{now},auth:coordinator)
            let session = AppSession(service:service); await session.restore()
            let late = Task { await session.acceptAuthCallback(callback(proof.state)) }; await api.wait()
            let fresh = Task { await session.signIn(.soop,consent:true) }; await browser.wait()
            let next = try store.pendingAuth(now:now)!
            await api.finish(.success(try returned())); await late.value
            check(session.busy && session.access == .signedOut && session.errorMessage == nil)
            _ = try await coordinator.accept(callback(next.proof.state)); await api.wait()
            await api.finish(.success(try returned(String(repeating:"z",count:43)))); await fresh.value
            check(session.access == .ready && session.account?.id == accountID)
            check(try store.read()?.token == String(repeating:"z",count:43))
            check(await api.revoked.count == 1)
        }
        // An expiry deadline cannot be skipped by a busy LINK operation.
        do {
            let (store,_,directory) = try fixture(); defer { try? FileManager.default.removeItem(at:directory) }
            _ = try store.replace(expected:nil,with:old)
            let clock = AuthClock(now); let api = AuthAPI(); let browser = AuthBrowser()
            let coordinator = SOOPAuthCoordinator(environment:.qa,store:store,api:api,browser:browser,now:{clock.read()})
            let gate = GatedAuth(coordinator)
            let service = NativeSessionService(environment:.qa,api:AuthNativeAPI(restricted:true),store:store,now:{clock.read()},auth:gate)
            let session = AppSession(service:service); await session.restore()
            check(session.access == .linkRequired)
            let flow = Task { await session.linkSOOP() }; await gate.wait(); check(session.busy)
            clock.set(old.expiresAt); await gate.holdClosing()
            let timer = Task { await session.expire(expected:old.expiresAt,now:old.expiresAt) }
            await gate.waitClosing()
            check(session.expiresAt == nil && session.access == .restoring)
            timer.cancel() // SwiftUI cancels .task(id: expiresAt) at this exact point.
            await gate.releaseClosing(); await timer.value
            check(session.account == nil && session.access == .signedOut)
            await gate.release(); await flow.value
            check(try store.read() == nil && store.pendingAuth(now:clock.read()) == nil)
        }
        // A previous callback can never finish the newer browser continuation.
        do {
            let browser = AuthBrowser(); let first = UUID(); let second = UUID()
            let one = Task { try await browser.authorize(URL(string:"https://api.qa.rogi.chat")!,environment:.qa,operation:first,validate:{}) }
            await browser.wait(); browser.cancel(operation:first)
            let two = Task { try await browser.authorize(URL(string:"https://api.qa.rogi.chat")!,environment:.qa,operation:second,validate:{}) }
            await browser.wait()
            check(!browser.deliver(callback(proof.state),operation:first) && browser.current == second)
            check(browser.deliver(callback(proof.state),operation:second))
            _ = try await two.value
            do { _ = try await one.value; preconditionFailure("browser cancel") } catch is CancellationError {}
        }
    }
    @MainActor static func scopedErrors() async throws {
        for error in [SOOPAuthError.unauthenticated, .terms, .recentAuth, .sessionChanged] {
            let (store,_,directory) = try fixture(); defer { try? FileManager.default.removeItem(at:directory) }
            _ = try store.replace(expected:nil,with:old)
            let api = AuthAPI(); let browser = AuthBrowser(); await api.setError(error)
            let coordinator = SOOPAuthCoordinator(environment:.qa,store:store,api:api,browser:browser,now:{now})
            let service = NativeSessionService(environment:.qa,api:AuthNativeAPI(),store:store,now:{now},auth:coordinator)
            _ = try await service.restore()
            do { _ = try await service.linkSOOP(); check(error == .sessionChanged) }
            catch { check(error as? ProductError == .unauthenticated || error as? SOOPAuthError == .terms || error as? SOOPAuthError == .recentAuth) }
            check(try store.read() == (error == .unauthenticated ? nil : old))
        }
        for error in [SOOPAuthError.unauthenticated, .sessionChanged] {
            let (store,_,directory) = try fixture(); defer { try? FileManager.default.removeItem(at:directory) }
            _ = try store.replace(expected:nil,with:old)
            let pending = try store.beginAuth(intent:.link,proof:proof,expected:old,accountID:accountID,serverGeneration:String(repeating:"g",count:43),now:now)
            let start = SOOPStartResponse(transactionId:UUID().uuidString.lowercased(),authorizeUrl:URL(string:"https://api.qa.rogi.chat/v1/auth/native/soop/launch?request=" + String(repeating:"r",count:43))!,expiresIn:600)
            _ = try store.finishAuthStart(id:pending.id,response:start,now:now)
            let api = AuthAPI(); let browser = AuthBrowser()
            let coordinator = SOOPAuthCoordinator(environment:.qa,store:store,api:api,browser:browser,now:{now})
            let service = NativeSessionService(environment:.qa,api:AuthNativeAPI(),store:store,now:{now},auth:coordinator)
            _ = try await service.restore(); await api.setError(error)
            do { _ = try await service.acceptAuthCallback(callback(proof.state)); check(error == .sessionChanged) }
            catch { check(error as? ProductError == .unauthenticated) }
            check(try store.read() == (error == .unauthenticated ? nil : old))
        }
        // A delayed cold LINK rejection cannot erase a newer authenticated session.
        do {
            let (store,_,directory) = try fixture(); defer { try? FileManager.default.removeItem(at:directory) }
            _ = try store.replace(expected:nil,with:old)
            let pending = try store.beginAuth(intent:.link,proof:proof,expected:old,accountID:accountID,serverGeneration:String(repeating:"g",count:43),now:now)
            let start = SOOPStartResponse(transactionId:UUID().uuidString.lowercased(),authorizeUrl:URL(string:"https://api.qa.rogi.chat/v1/auth/native/soop/launch?request=" + String(repeating:"r",count:43))!,expiresIn:600)
            _ = try store.finishAuthStart(id:pending.id,response:start,now:now)
            let api = AuthAPI(); let browser = AuthBrowser()
            let coordinator = SOOPAuthCoordinator(environment:.qa,store:store,api:api,browser:browser,now:{now})
            let service = NativeSessionService(environment:.qa,api:AuthNativeAPI(),store:store,now:{now},auth:coordinator)
            _ = try await service.restore()
            let cold = Task { try await service.acceptAuthCallback(callback(proof.state)) }; await api.wait()
            let newer = NativeCredential(token:String(repeating:"z",count:43),expiresAt:old.expiresAt,environment:.qa)
            _ = try store.replace(expected:old,with:newer); _ = try await service.restore()
            await api.finish(.failure(SOOPAuthError.unauthenticated))
            do { _ = try await cold.value; preconditionFailure("old cold failure") } catch ProductError.sessionChanged {}
            check(try store.read() == newer)
        }
    }

}
