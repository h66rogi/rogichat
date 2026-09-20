import Foundation
import CryptoKit

struct AccountDeletionReceipt: Codable, Sendable, Equatable {
    let requestId: String
    let status: String
    var valid: Bool {
        status == "blocked" && requestId.utf8.count == 36 && requestId.range(of: "^[0-9a-f]{8}-[0-9a-f]{4}-[45][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$", options: .regularExpression) != nil
    }
}
enum AccountDeletionResponse: Sendable, Equatable {
    case acknowledged(AccountDeletionReceipt), recentAuth, rejected, unknown
    var outcome: AccountDeletionOutcome {
        switch self { case .acknowledged: .acknowledged; case .recentAuth: .recentAuthRequired; case .rejected: .rejected; case .unknown: .unknown }
    }
    var receipt: AccountDeletionReceipt? { if case .acknowledged(let value) = self { value } else { nil } }
}
struct AccountDeletionRecord: Codable, Sendable, CustomStringConvertible, CustomDebugStringConvertible, CustomReflectable {
    enum Phase: String, Codable, Sendable { case preparing, dispatchClaimed, finished }
    let id: UUID
    let installation: UUID
    let environment: NativeEnvironment
    let accountID: String
    let clientScope: UUID
    let fingerprint: String
    var authEpoch: UUID
    var quarantine: NativeCredential?
    var phase: Phase = .preparing
    var outcome: AccountDeletionOutcome = .preparing
    var receipt: AccountDeletionReceipt?
    var cleanupPending = true
    var revision: UInt64 = 0
    var released = false
    var description: String { "AccountDeletionRecord(<redacted>)" }
    var debugDescription: String { description }
    var customMirror: Mirror { Mirror(self, children: ["deletion": "<redacted>"]) }
    static func fingerprint(_ credential: NativeCredential) -> String {
        SHA256.hash(data: Data(("rogichat-account-admission-v1:" + credential.environment.rawValue + ":" + credential.token).utf8)).map { String(format: "%02x", $0) }.joined()
    }
    var valid: Bool {
        UUID(uuidString: accountID) != nil && fingerprint.count == 64 && fingerprint.utf8.allSatisfy { (48...57).contains($0) || (97...102).contains($0) }
        && (quarantine.map { $0.isValid && $0.environment == environment && Self.fingerprint($0) == fingerprint } ?? true)
        && (receipt.map(\.valid) ?? true) && (outcome == .acknowledged) == (receipt != nil)
        && revision < UInt64.max
        && (phase != .finished || outcome != .preparing)
        && (cleanupPending || quarantine == nil)
        && (phase == .finished || (cleanupPending && quarantine != nil))
        && (phase != .preparing || outcome == .preparing) && (phase != .dispatchClaimed || outcome == .unknown) && (!released || (outcome == .recentAuthRequired && phase == .finished && !cleanupPending && quarantine == nil))
    }
    var presentation: AccountDeletionPresentation {
        AccountDeletionPresentation(id: id, outcome: outcome, requestID: receipt?.requestId, cleanupPending: cleanupPending, accountID: accountID)
    }
}
protocol AccountDeletionStoring: NativeCredentialStoring {
    func deletionRecords() throws -> [AccountDeletionRecord]
    func reserveDeletion(_ intent: AccountDeletionIntent, expected: NativeCredential) throws -> AccountDeletionRecord
    func claimDeletion(_ record: AccountDeletionRecord) throws -> AccountDeletionRecord
    func classifyDeletion(_ record: AccountDeletionRecord, response: AccountDeletionResponse) throws -> AccountDeletionRecord
    func verifyDeletionCleanup(_ record: AccountDeletionRecord) throws
    func finishDeletion(_ record: AccountDeletionRecord) throws -> AccountDeletionRecord
    func releaseDeletion(_ record: AccountDeletionRecord, now: Date) throws -> NativeCredential
    func recoverDeletion(_ record: AccountDeletionRecord) throws -> AccountDeletionRecord
}
// This permit is consumed at the HTTP actor, not when the UI creates its Task.
final class AccountDeletionPermit: @unchecked Sendable {
    private let lock = NSLock()
    private var consumed = false
    private var cancelled = false
    private let expiresAt: Date
    private let now: @Sendable () -> Date
    init(expiresAt: Date = .distantFuture, now: @escaping @Sendable () -> Date = { Date() }) { self.expiresAt = expiresAt; self.now = now }
    func cancel() { lock.withLock { cancelled = true } }
    func claim() throws {
        try lock.withLock {
            guard !consumed, !cancelled, expiresAt > now() else { throw ProductError.sessionChanged }
            consumed = true
        }
    }
}
struct AccountDeletionEndpoint {
    static let maximumBytes = 8192
    static func request(environment: NativeEnvironment, credential: NativeCredential) throws -> URLRequest {
        guard credential.isValid, credential.environment == environment else { throw ProductError.secureStorage }
        var request = URLRequest(url: environment.baseURL.appendingPathComponent("me/account"))
        request.httpMethod = "DELETE"; request.httpBody = Data("{}".utf8)
        request.httpShouldHandleCookies = false; request.cachePolicy = .reloadIgnoringLocalCacheData
        request.setValue("Bearer \(credential.token)", forHTTPHeaderField: "Authorization")
        request.setValue("ios", forHTTPHeaderField: "X-Rogi-Client")
        request.setValue("application/json", forHTTPHeaderField: "Accept")
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        return request
    }
    static func response(_ data: Data, status: Int) -> AccountDeletionResponse {
        guard data.count <= maximumBytes, let values = try? DeletionJSON.object(data) else { return .unknown }
        if status == 200, Set(values.keys) == ["requestId", "status"],
           let id = values["requestId"] as? String, let state = values["status"] as? String {
            let receipt = AccountDeletionReceipt(requestId: id, status: state)
            return receipt.valid ? .acknowledged(receipt) : .unknown
        }
        guard Set(values.keys) == ["error"], let error = values["error"] as? [String: Any],
              Set(error.keys) == ["code"], let code = error["code"] as? String else { return .unknown }
        if status == 403 && code == "RECENT_AUTH_REQUIRED" { return .recentAuth }
        let rejected: [Int: Set<String>] = [400:["INVALID_REQUEST", "BAD_REQUEST"], 401:["UNAUTHENTICATED"], 403:["FORBIDDEN"], 413:["PAYLOAD_TOO_LARGE"], 429:["RATE_LIMITED", "BAD_REQUEST"]]
        return rejected[status]?.contains(code) == true ? .rejected : .unknown
    }
}
protocol AccountDeletionRequesting: Sendable {
    func performAccountDeletion(credential: NativeCredential, permit: AccountDeletionPermit) async throws -> AccountDeletionResponse
}
// Tiny fixed-shape JSON grammar. Decode each JSON string with Foundation after
// lexing its full quoted token; compare decoded keys to reject escaped duplicates.
private enum DeletionJSON {
    static func object(_ data: Data) throws -> [String: Any] {
        guard String(data: data, encoding: .utf8) != nil else { throw ProductError.invalidResponse }
        var parser = Parser(bytes: Array(data)); let result = try parser.object(depth: 0)
        parser.whitespace(); guard parser.index == parser.bytes.count else { throw ProductError.invalidResponse }
        return result
    }
    private struct Parser {
        let bytes: [UInt8]; var index = 0
        mutating func whitespace() { while index < bytes.count && [9,10,13,32].contains(bytes[index]) { index += 1 } }
        mutating func take(_ byte: UInt8) throws { whitespace(); guard index < bytes.count, bytes[index] == byte else { throw ProductError.invalidResponse }; index += 1 }
        mutating func string() throws -> String {
            whitespace(); let start = index; try take(34)
            while index < bytes.count {
                let byte = bytes[index]; index += 1
                if byte == 92 { guard index < bytes.count else { throw ProductError.invalidResponse }; index += 1 }
                else if byte == 34 { return try JSONDecoder().decode(String.self, from: Data(bytes[start..<index])) }
            }
            throw ProductError.invalidResponse
        }
        mutating func object(depth: Int) throws -> [String: Any] {
            guard depth <= 1 else { throw ProductError.invalidResponse }
            try take(123); whitespace(); var result: [String: Any] = [:]
            if index < bytes.count && bytes[index] == 125 { index += 1; return result }
            while true {
                let key = try string(); guard result[key] == nil, result.count < 3 else { throw ProductError.invalidResponse }
                try take(58); whitespace()
                if index < bytes.count && bytes[index] == 123 { result[key] = try object(depth: depth + 1) }
                else { result[key] = try string() }
                whitespace(); guard index < bytes.count else { throw ProductError.invalidResponse }
                if bytes[index] == 125 { index += 1; return result }
                try take(44)
            }
        }
    }
}
