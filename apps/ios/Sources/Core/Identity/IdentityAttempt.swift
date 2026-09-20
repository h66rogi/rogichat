import Foundation

enum IdentityIntent: Sendable { case login, link }
struct IdentityScope: Equatable, Sendable {
    let environment: String
    let sessionEpoch: UUID
    let accountID: String?
}
struct IdentityTicket: Equatable, Sendable {
    fileprivate let operation: UUID
    let scope: IdentityScope
    let intent: IdentityIntent
}
// OS writer binds protected persistent epoch before presenting Apple/browser UI.
// Server /me determines SOOP readiness; provider credential alone never does.
struct IdentityAttempt: Sendable {
    private var scope: IdentityScope?
    private var pending: IdentityTicket?
    mutating func bind(_ value: IdentityScope) {
        if scope != value { pending = nil; scope = value }
    }
    mutating func begin(_ intent: IdentityIntent) -> IdentityTicket? {
        guard let scope, intent == .login ? scope.accountID == nil : scope.accountID != nil else { return nil }
        let ticket = IdentityTicket(operation: UUID(), scope: scope, intent: intent)
        pending = ticket
        return ticket
    }
    func current(_ ticket: IdentityTicket) -> Bool { pending == ticket && scope == ticket.scope }
    mutating func consume(_ ticket: IdentityTicket) -> Bool {
        guard current(ticket) else { return false }
        pending = nil
        return true
    }
    mutating func cancel() { pending = nil }
}
