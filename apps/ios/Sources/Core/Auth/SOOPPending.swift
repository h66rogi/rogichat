import Foundation

struct SOOPPending: Codable, Equatable, Sendable, CustomStringConvertible, CustomDebugStringConvertible, CustomReflectable {
    enum Phase: String, Codable, Sendable { case starting, browser, exchanging }
    let id: UUID
    let installation: UUID
    let environment: NativeEnvironment
    let intent: SOOPIntent
    let proof: SOOPProof
    let createdAt: Date
    let originalCredential: NativeCredential?
    let accountID: String?
    let serverGeneration: String?
    var provider: String? = nil // nil is the backwards-compatible SOOP record.
    var nativeNonce: String? = nil
    var nativeState: String? = nil
    var phase: Phase = .starting
    var transactionID: String?
    var authorizeURL: URL?
    var description: String { "SOOPPending(<redacted>)" }
    var debugDescription: String { description }
    var customMirror: Mirror { Mirror(self, children: ["pending": "<redacted>"]) }
    func isCurrent(at now: Date) -> Bool { now >= createdAt && now.timeIntervalSince(createdAt) < 600 }
}
protocol SOOPAuthStoring: NativeCredentialStoring {
    func beginAuth(intent: SOOPIntent, proof: SOOPProof, expected: NativeCredential?, accountID: String?, serverGeneration: String?, now: Date) throws -> SOOPPending
    func pendingAuth(now: Date) throws -> SOOPPending?
    func finishAuthStart(id: UUID, response: SOOPStartResponse, now: Date) throws -> SOOPPending
    func claimAuthExchange(id: UUID, now: Date) throws -> SOOPPending
    func installAuth(id: UUID, credential: NativeCredential, now: Date) throws
    func acknowledgeAuth(id: UUID, credential: NativeCredential) throws
    func discardAuth(id: UUID, credential: NativeCredential) throws
    func cancelAuth(id: UUID?) throws
    func reconcileAuth(accountID: String?, serverGeneration: String?) throws
    func recoverAuth(now: Date) throws -> String?
    func resetConfirmed() throws
}

protocol AppleAuthStoring: SOOPAuthStoring {
    func beginApple(intent: SOOPIntent, proof: SOOPProof, expected: NativeCredential?, accountID: String?, serverGeneration: String?, now: Date) throws -> SOOPPending
    func finishAppleStart(id: UUID, transaction: String, nonce: String, state: String, now: Date) throws -> SOOPPending
}
