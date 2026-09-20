import Foundation

struct RealtimeScope: Equatable, Sendable {
    let environment: String
    let accountID: String
    let accountGeneration: String
    let sessionEpoch: UUID
}
struct RealtimeConnectionOptions: Sendable, CustomStringConvertible, CustomDebugStringConvertible, CustomReflectable {
    let origin: URL
    let path = "/v1/realtime"
    let namespace = "/"
    let reconnects = false
    let forceWebSockets = true
    private let bearer: String
    init(scope: RealtimeScope, bearer: String) throws {
        guard ["qa", "prod"].contains(scope.environment), !scope.accountID.isEmpty, !scope.accountGeneration.isEmpty,
              bearer.utf8.count == 43, bearer.range(of: "^[A-Za-z0-9_-]{43}$", options: .regularExpression) != nil else {
            throw RealtimeContractError.invalid
        }
        origin = URL(string: scope.environment == "qa" ? "https://api.qa.rogi.chat" : "https://api.rogi.chat")!
        self.bearer = bearer
    }
    var headers: [String: String] { ["Authorization": "Bearer \(bearer)", "X-Rogi-Client": "ios"] }
    var description: String { "RealtimeConnectionOptions([redacted])" }
    var debugDescription: String { description }
    var customMirror: Mirror { Mirror(self, children: ["options": "[redacted]"]) }
}
enum RealtimeContractError: Error { case invalid }
enum RealtimeHint {
    static func valid(_ json: String) -> Bool {
        guard json.utf8.count <= 128 else { return false }
        return json.range(of: #"\A[ \t\r\n]*\{[ \t\r\n]*"schemaVersion"[ \t\r\n]*:[ \t\r\n]*1[ \t\r\n]*\}[ \t\r\n]*\z"#, options: .regularExpression) != nil
    }
}
enum RealtimeStatus: Sendable { case disconnected, connecting, connected, revalidationRequired }
struct RealtimeTicket: Equatable, Sendable {
    fileprivate let id: UUID
    let scope: RealtimeScope
}
// Caller confines to one actor. Authorization and UI state remain in the OS session owner.
struct RealtimeLifecycle: Sendable {
    private var scope: RealtimeScope?
    private var foreground = false
    private var ticket: RealtimeTicket?
    private(set) var status = RealtimeStatus.disconnected
    mutating func bind(scope: RealtimeScope?, foreground: Bool) -> Bool {
        guard self.scope != scope || self.foreground != foreground else { return false }
        self.scope = scope; self.foreground = foreground; ticket = nil; status = .disconnected
        return true
    }
    mutating func begin(expected: RealtimeScope) -> RealtimeTicket? {
        guard scope == expected, foreground else { return nil }
        let value = RealtimeTicket(id: UUID(), scope: expected)
        ticket = value; status = .connecting
        return value
    }
    mutating func connected(_ value: RealtimeTicket) -> Bool {
        guard current(value), status == .connecting else { return false }
        status = .connected
        return true
    }
    func wake(_ value: RealtimeTicket, payload: String) -> Bool {
        current(value) && status == .connected && RealtimeHint.valid(payload)
    }
    mutating func disconnected(_ value: RealtimeTicket) -> Bool {
        guard current(value), status != .revalidationRequired else { return false }
        status = .revalidationRequired
        return true
    }
    func canReconnect(_ value: RealtimeTicket) -> Bool { current(value) && status == .revalidationRequired }
    mutating func close(_ value: RealtimeTicket) {
        if current(value) { ticket = nil; status = .disconnected }
    }
    private func current(_ value: RealtimeTicket) -> Bool { ticket == value && scope == value.scope && foreground }
}
