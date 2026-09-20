import Foundation

// No URL scheme/associated-domain registration. Future adapters must inject a verified environment policy.
struct RoomRouteHint: Equatable, Sendable { let roomID: String }
struct ContentRouteParser: Sendable {
    let allowedHost: String
    let roomPathPrefix: String
    func parse(_ value: String) -> RoomRouteHint? {
        guard value.utf8.count <= 2048, let url = URLComponents(string: value),
              url.scheme == "https", url.host == allowedHost, url.port == nil,
              url.user == nil, url.password == nil, url.query == nil, url.fragment == nil,
              url.percentEncodedPath.hasPrefix(roomPathPrefix) else { return nil }
        let id = String(url.percentEncodedPath.dropFirst(roomPathPrefix.count))
        let allowed = "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789_-"
        guard (1...128).contains(id.utf8.count), id.allSatisfy({ allowed.contains($0) }) else { return nil }
        return RoomRouteHint(roomID: id)
    }
}
struct RouteTicket: Equatable, Sendable {
    let revision: UInt64
    let scope: UInt64
    let hint: RoomRouteHint
    fileprivate let eventID: String
    fileprivate let expiresAt: UInt64
}
// Value reducer; caller must keep it on one actor. It does not perform navigation or authorization.
struct PendingRouteQueue: Sendable {
    static let ttl: UInt64 = 300_000
    private var scope: UInt64 = 0
    private var revision: UInt64 = 0
    private var pending: RouteTicket?
    private var consumed: [(String, UInt64)] = []
    var scopeToken: UInt64 { scope }
    mutating func resetScope() { scope += 1; revision += 1; pending = nil; consumed.removeAll() }
    @discardableResult mutating func cancel(_ ticket: RouteTicket) -> Bool {
        guard pending == ticket, ticket.scope == scope else { return false }
        pending = nil; revision += 1
        return true
    }
    @discardableResult mutating func offer(_ hint: RoomRouteHint, eventID: String, now: UInt64, expectedScope: UInt64) -> Bool {
        guard expectedScope == scope else { return false }
        precondition(now <= UInt64.max - Self.ttl)
        guard !eventID.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty, eventID.count <= 256 else { return false }
        consumed.removeAll { $0.1 <= now }
        if consumed.contains(where: { $0.0 == eventID }) { return false }
        if let pending, pending.eventID == eventID, pending.expiresAt > now { return false }
        revision += 1
        pending = RouteTicket(revision: revision, scope: scope, hint: hint, eventID: eventID, expiresAt: now + Self.ttl)
        return true
    }
    mutating func begin(now: UInt64) -> RouteTicket? {
        if let current = pending, now >= current.expiresAt { pending = nil }
        return pending
    }
    mutating func consume(_ ticket: RouteTicket, now: UInt64) -> RoomRouteHint? {
        guard let current = begin(now: now), current == ticket, ticket.scope == scope else { return nil }
        pending = nil
        consumed.append((ticket.eventID, ticket.expiresAt))
        if consumed.count > 64 { consumed.removeFirst() }
        return ticket.hint
    }
}
