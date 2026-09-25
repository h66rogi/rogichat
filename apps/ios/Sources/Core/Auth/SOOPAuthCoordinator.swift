import Foundation

protocol SOOPRequesting: Sendable {
    func performSOOP(_ request: SOOPRequest, credential: NativeCredential?) async throws -> Data
    func performSOOP(_ request: SOOPRequest, credential: NativeCredential?, admit: @escaping @Sendable () throws -> Void) async throws -> Data
    func revokeSOOPCredential(_ credential: NativeCredential) async
}
extension SOOPRequesting {
    func performSOOP(_ request: SOOPRequest, credential: NativeCredential?, admit: @escaping @Sendable () throws -> Void) async throws -> Data {
        try admit(); return try await performSOOP(request, credential: credential)
    }
}
enum SOOPRequest: Sendable {
    case start(SOOPStart), exchange(SOOPExchange), password(PasswordInput)
    func request(environment: NativeEnvironment, credential: NativeCredential?) throws -> URLRequest {
        let path: String
        let body: Data
        switch self {
        case .start(let input):
            guard input.intent == .login ? credential == nil : credential != nil else { throw SOOPAuthError.invalidRequest }
            path = "auth/native/soop/transactions"; body = try JSONEncoder().encode(input)
        case .password(let input):
            guard input.changing == (credential != nil) else { throw ProductError.sessionChanged }
            path = input.changing ? "auth/password/change" : "auth/password/login"; body = try input.body()
        case .exchange(let input): path = "auth/native/completions/exchange"; body = try JSONEncoder().encode(input)
        }
        var request = URLRequest(url: environment.baseURL.appendingPathComponent(path))
        request.httpMethod = "POST"; request.httpBody = body
        request.cachePolicy = .reloadIgnoringLocalCacheData; request.httpShouldHandleCookies = false
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        request.setValue("application/json", forHTTPHeaderField: "Accept")
        request.setValue("ios", forHTTPHeaderField: "X-Rogi-Client")
        if let credential {
            guard credential.isValid, credential.environment == environment else { throw ProductError.secureStorage }
            request.setValue("Bearer \(credential.token)", forHTTPHeaderField: "Authorization")
        }
        return request
    }
}
protocol SOOPBrowsing: Sendable {
    @MainActor func authorize(_ url: URL, environment: NativeEnvironment, operation: UUID, validate: @Sendable () throws -> Void) async throws -> URL
    @MainActor func deliver(_ url: URL, operation: UUID) -> Bool
    @MainActor func cancel(operation: UUID)
}
struct SOOPAuthResult: Sendable { let id: UUID; let credential: NativeCredential; let snapshot: SessionSnapshot }
protocol SOOPAuthenticating: Sendable {
    func authenticate(pending: SOOPPending, consentVersion: String?, attempt: SessionAttempt) async throws -> SOOPAuthResult
    func accept(_ url: URL) async throws -> SOOPAuthResult?
    func closeBrowser() async
    func discard(_ result: SOOPAuthResult) async
}
actor SOOPAuthCoordinator: SOOPAuthenticating {
    private let environment: NativeEnvironment
    private let store: any SOOPAuthStoring
    private let api: any SOOPRequesting
    private let browser: any SOOPBrowsing
    private let now: @Sendable () -> Date
    private var browserOperation: UUID?
    init(environment: NativeEnvironment, store: any SOOPAuthStoring, api: any SOOPRequesting, browser: any SOOPBrowsing,
         now: @escaping @Sendable () -> Date = { Date() }) {
        self.environment = environment; self.store = store; self.api = api; self.browser = browser; self.now = now
    }
    func authenticate(pending: SOOPPending, consentVersion: String?, attempt: SessionAttempt = SessionAttempt()) async throws -> SOOPAuthResult {
        guard pending.provider == nil, pending.intent == .login ? pending.originalCredential == nil : pending.originalCredential != nil else { throw SOOPAuthError.invalidRequest }
        // Reservation belongs to the service before its first actor hop. A cancelled
        // ticket cannot create a fresh pending operation when this actor finally runs.
        var preservePending = false
        do {
            try attempt.check(); try requireReserved(pending)
            await closeBrowser()
            try attempt.check(); try requireReserved(pending)
            let start = SOOPStart(intent: pending.intent, codeChallenge: pending.proof.challenge, returnState: pending.proof.state, termsVersion: nil)
            let data = try await api.performSOOP(.start(start), credential: pending.originalCredential, admit: admission(pending, phase: .starting, attempt: attempt))
            try Task.checkCancellation()
            let response = try decode(SOOPStartResponse.self, data)
            let launched = try store.finishAuthStart(id: pending.id, response: response, now: now())
            browserOperation = launched.id
            let store = store; let clock = now
            let callback = try await browser.authorize(response.authorizeUrl, environment: environment, operation: launched.id, validate: {
                try attempt.check()
                guard try store.pendingAuth(now: clock())?.id == launched.id else { throw SOOPAuthError.sessionChanged }
            })
            if browserOperation == launched.id { browserOperation = nil }
            do { _ = try SOOPCallback.parse(callback, environment: environment, expectedState: launched.proof.state) }
            catch { preservePending = true; throw error }
            return try await complete(callback, expectedID: launched.id, attempt: attempt)
        } catch {
            if browserOperation == pending.id { browserOperation = nil }
            if !preservePending { try store.cancelAuth(id: pending.id) }
            throw error
        }
    }
    private func admission(_ pending: SOOPPending, phase: SOOPPending.Phase, attempt: SessionAttempt) -> @Sendable () throws -> Void {
        let store = store; let now = now
        return {
            try attempt.check()
            guard let value = try store.pendingAuth(now: now()), value.id == pending.id, value.provider == nil,
                  value.phase == phase else { throw SOOPAuthError.sessionChanged }
        }
    }
    private func requireReserved(_ pending: SOOPPending) throws {
        try Task.checkCancellation()
        guard let current = try store.pendingAuth(now: now()), current.id == pending.id, current.phase == .starting else { throw SOOPAuthError.sessionChanged }
    }
    // Both ASWebAuthenticationSession and Universal Links enter the same parser.
    // A warm link completes the existing continuation; a cold link owns completion.
    func accept(_ url: URL) async throws -> SOOPAuthResult? {
        guard let pending = try store.pendingAuth(now: now()), pending.provider == nil else { throw SOOPAuthError.failed }
        _ = try SOOPCallback.parse(url, environment: environment, expectedState: pending.proof.state)
        if pending.phase == .exchanging { return nil }
        if browserOperation == pending.id, await browser.deliver(url, operation: pending.id) { return nil }
        return try await complete(url, expectedID: pending.id)
    }
    func cancel() async throws {
        try store.cancelAuth(id: nil)
        await closeBrowser()
    }
    func closeBrowser() async {
        let id = browserOperation; browserOperation = nil
        if let id { await browser.cancel(operation: id) }
    }
    private func complete(_ url: URL, expectedID: UUID, attempt: SessionAttempt = SessionAttempt()) async throws -> SOOPAuthResult {
        guard let pending = try store.pendingAuth(now: now()), pending.id == expectedID else { throw SOOPAuthError.sessionChanged }
        let callback = try SOOPCallback.parse(url, environment: environment, expectedState: pending.proof.state)
        if case .failure(let error) = callback { try store.cancelAuth(id: pending.id); throw error }
        guard case .completion(let code) = callback else { throw SOOPAuthError.failed }
        try attempt.check()
        let claimed = try store.claimAuthExchange(id: pending.id, now: now())
        let request = SOOPExchange(transactionId: claimed.transactionID!, code: code, codeVerifier: claimed.proof.verifier)
        var returned: NativeCredential?
        do {
            // One attempt only. The protected 'exchanging' record survives a lost response.
            let data = try await api.performSOOP(.exchange(request), credential: claimed.originalCredential, admit: admission(claimed, phase: .exchanging, attempt: attempt))
            // Capture only a valid returned token before nested DTO validation so a
            // rejected response can revoke its newly issued credential best-effort.
            returned = try decode(SOOPIssuedCredential.self, data).credential(environment: environment, now: now())
            let response = try decode(SOOPExchangeResponse.self, data)
            let (credential, snapshot) = try response.validated(environment: environment, now: now())
            try attempt.check()
            guard claimed.intent != .link || snapshot.account?.id == claimed.accountID else { throw SOOPAuthError.sessionChanged }
            try store.installAuth(id: claimed.id, credential: credential, now: now())
            return SOOPAuthResult(id: claimed.id, credential: credential, snapshot: snapshot)
        } catch {
            try? store.cancelAuth(id: claimed.id)
            if let returned, returned != claimed.originalCredential {
                // Never revoke another completed flow's currently installed credential.
                let current = try? store.read()
                if current != returned {
                    let api = api
                    await Task.detached { await api.revokeSOOPCredential(returned) }.value
                }
            }
            if error is CancellationError || error as? SOOPAuthError != nil || error as? ProductError == .secureStorage { throw error }
            throw SOOPAuthError.exchangeUncertain
        }
    }
    func discard(_ result: SOOPAuthResult) async {
        try? store.discardAuth(id: result.id, credential: result.credential)
        // An acknowledged current credential is never revoked by a stale result.
        if (try? store.read()) != result.credential {
            let api = api
            await Task.detached { await api.revokeSOOPCredential(result.credential) }.value
        }
    }
    private func decode<T: Decodable>(_ type: T.Type, _ data: Data) throws -> T {
        do { return try JSONDecoder().decode(type, from: data) } catch { throw ProductError.invalidResponse }
    }
}
