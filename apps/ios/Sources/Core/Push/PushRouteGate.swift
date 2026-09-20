import Foundation

// Meloming PushNotificationManager single dispatch, adapted to the existing strict
// route queue. The provider payload is a hint, never proof of room membership.
struct PushRouteGate: Sendable {
    let parser: ContentRouteParser
    private var queue = PendingRouteQueue()
    private var scope: PushScope?
    init(parser: ContentRouteParser) { self.parser = parser }
    mutating func bind(_ value: PushScope?) {
        if scope != value { queue.resetScope(); scope = value }
    }
    mutating func offer(url: String, eventID: String, expected: PushScope, now: UInt64) -> Bool {
        guard expected == scope, let hint = parser.parse(url) else { return false }
        return queue.offer(hint, eventID: eventID, now: now, expectedScope: queue.scopeToken)
    }
    mutating func begin(now: UInt64) -> RouteTicket? { scope == nil ? nil : queue.begin(now: now) }
    // Call after real /me + room detail authorization, then navigate in this actor turn.
    mutating func authorized(_ ticket: RouteTicket, expected: PushScope, roomID: String, now: UInt64) -> RoomRouteHint? {
        guard expected == scope, ticket.hint.roomID == roomID else { return nil }
        return queue.consume(ticket, now: now)
    }
    mutating func denied(_ ticket: RouteTicket) { queue.cancel(ticket) }
}
