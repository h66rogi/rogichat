import Foundation

struct AppleProviderMaterial: Sendable, CustomStringConvertible {
    let code: String
    let token: String
    let state: String
    var description: String { "AppleProviderMaterial([redacted])" }
}
protocol AppleAuthorizing: Sendable {
    @MainActor func authorize(nonce: String, state: String, operation: UUID, validate: @Sendable () throws -> Void) async throws -> AppleProviderMaterial
    @MainActor func cancel(operation: UUID)
}
actor AppleIdentityCoordinator: SOOPAuthenticating {
    private let environment: NativeEnvironment
    private let store: any AppleAuthStoring
    private let api: any AppleIdentityRequesting
    private let revoker: any SOOPRequesting
    private let provider: any AppleAuthorizing
    private let now: @Sendable () -> Date
    private var operation: UUID?
    init(environment: NativeEnvironment, store: any AppleAuthStoring, api: any AppleIdentityRequesting,
         revoker: any SOOPRequesting, provider: any AppleAuthorizing, now: @escaping @Sendable () -> Date = { Date() }) {
        self.environment = environment; self.store = store; self.api = api; self.revoker = revoker; self.provider = provider; self.now = now
    }
    private func current(_ pending: SOOPPending, attempt: SessionAttempt) throws {
        try attempt.check()
        guard try store.pendingAuth(now: now())?.id == pending.id else { throw SOOPAuthError.sessionChanged }
    }
    func authenticate(pending: SOOPPending, consentVersion: String?, attempt: SessionAttempt) async throws -> SOOPAuthResult {
        guard pending.provider == "apple", pending.phase == .starting,
              pending.intent == .login ? consentVersion == "2026-09-20" : consentVersion == nil else { throw SOOPAuthError.consentRequired }
        let intent: IdentityIntent = pending.intent == .login ? .login : .link
        var returned: NativeCredential?
        var exchanged = false
        do {
            try current(pending, attempt: attempt)
            await closeBrowser(); try current(pending, attempt: attempt)
            let data = try await api.performApple(.start(AppleIdentityStart(intent: intent, codeChallenge: pending.proof.challenge, returnState: pending.proof.state)), intent: intent, originalCredential: pending.originalCredential, admit: admission(pending, phase: .starting, attempt: attempt))
            let response = try JSONDecoder().decode(AppleIdentityStartResponse.self, from: data); try response.validate()
            try current(pending, attempt: attempt)
            let launched = try store.finishAppleStart(id: pending.id, transaction: response.transactionId, nonce: response.nonce, state: response.state, now: now())
            operation = launched.id
            let store = store; let clock = now
            let material = try await provider.authorize(nonce: response.nonce, state: response.state, operation: launched.id, validate: {
                try attempt.check()
                guard try store.pendingAuth(now: clock())?.id == launched.id else { throw SOOPAuthError.sessionChanged }
            })
            if operation == launched.id { operation = nil }
            try current(launched, attempt: attempt)
            guard material.state == launched.nativeState else { throw AppleIdentityError.invalidResponse }
            // One durable consumed state BEFORE either irreversible complete/exchange request.
            let claimed = try store.claimAuthExchange(id: launched.id, now: now())
            let completion = try await api.performApple(.complete(AppleIdentityComplete(transactionId: response.transactionId, state: response.state,
                authorizationCode: material.code, identityToken: material.token, codeVerifier: claimed.proof.verifier)), intent: intent, originalCredential: claimed.originalCredential, admit: admission(claimed, phase: .exchanging, attempt: attempt))
            try current(claimed, attempt: attempt)
            let code = try AppleIdentityContract.completion(completion)
            exchanged = true
            let result = try await api.performApple(.exchange(AppleIdentityExchange(transactionId: response.transactionId, code: code, codeVerifier: claimed.proof.verifier)), intent: intent, originalCredential: claimed.originalCredential, admit: admission(claimed, phase: .exchanging, attempt: attempt))
            returned = try JSONDecoder().decode(SOOPIssuedCredential.self, from: result).credential(environment: environment, now: now())
            let (credential, snapshot) = try JSONDecoder().decode(SOOPExchangeResponse.self, from: result).validated(environment: environment, now: now())
            try current(claimed, attempt: attempt)
            guard claimed.intent != .link || snapshot.account?.id == claimed.accountID else { throw SOOPAuthError.sessionChanged }
            try store.installAuth(id: claimed.id, credential: credential, now: now())
            return SOOPAuthResult(id: claimed.id, credential: credential, snapshot: snapshot)
        } catch {
            if operation == pending.id { operation = nil; await provider.cancel(operation: pending.id) }
            var cleanupError: (any Error)?
            do { try store.cancelAuth(id: pending.id) } catch { cleanupError = error }
            if let returned, returned != pending.originalCredential, (try? store.read()) != returned {
                let revoker = revoker
                await Task.detached { await revoker.revokeSOOPCredential(returned) }.value
            }
            if let cleanupError { throw cleanupError }
            if error is CancellationError || error is SOOPAuthError || error is AppleIdentityProblem || error as? ProductError == .secureStorage { throw error }
            if exchanged { throw AppleIdentityProblem.unknownResult }
            throw error
        }
    }
    private func admission(_ pending: SOOPPending, phase: SOOPPending.Phase, attempt: SessionAttempt) -> @Sendable () throws -> Void {
        let store = store; let now = now
        return {
            try attempt.check()
            guard let value = try store.pendingAuth(now: now()), value.id == pending.id,
                  value.provider == "apple", value.phase == phase else { throw SOOPAuthError.sessionChanged }
        }
    }
    func accept(_ url: URL) async throws -> SOOPAuthResult? { throw AppleIdentityError.invalidRequest }
    func closeBrowser() async { if let operation { self.operation = nil; await provider.cancel(operation: operation) } }
    func discard(_ result: SOOPAuthResult) async {
        try? store.discardAuth(id: result.id, credential: result.credential)
        if (try? store.read()) != result.credential { let revoker = revoker; await Task.detached { await revoker.revokeSOOPCredential(result.credential) }.value }
    }
}
// Both providers use exactly the same reserved proof, persistent cancellation and publication CAS.
struct NativeIdentityRouter: SOOPAuthenticating {
    let soop: any SOOPAuthenticating
    let apple: any SOOPAuthenticating
    func authenticate(pending: SOOPPending, consentVersion: String?, attempt: SessionAttempt) async throws -> SOOPAuthResult {
        try await (pending.provider == "apple" ? apple : soop).authenticate(pending: pending, consentVersion: consentVersion, attempt: attempt)
    }
    func accept(_ url: URL) async throws -> SOOPAuthResult? { try await soop.accept(url) }
    func closeBrowser() async { await soop.closeBrowser(); await apple.closeBrowser() }
    func discard(_ result: SOOPAuthResult) async { await soop.discard(result) }
}
