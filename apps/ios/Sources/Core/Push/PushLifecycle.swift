import Foundation

// Epochs are supplied by the OS owner's protected persistent store, never a view counter.
struct PushScope: Equatable, Sendable {
    let environment: String
    let accountID: String
    let accountGeneration: String
    let sessionEpoch: UUID
    let installationEpoch: UUID
}
enum PushPermission: Sendable { case unknown, notDetermined, denied, authorized }
enum PushRegistrationState: Sendable { case inactive, unavailable, fetching, registering, registered, retryRequired }
struct DevicePushToken: Sendable, CustomStringConvertible, CustomDebugStringConvertible {
    let value: String
    init(_ value: String) throws {
        guard !value.isEmpty, value.utf8.count <= 4096,
              !value.unicodeScalars.contains(where: { CharacterSet.whitespacesAndNewlines.union(.controlCharacters).contains($0) }) else {
            throw PushTokenError.invalid
        }
        self.value = value
    }
    var description: String { "DevicePushToken([redacted])" }
    var debugDescription: String { description }
}
enum PushTokenError: Error { case invalid }
struct PushTicket: Equatable, Sendable {
    fileprivate let id: UUID
    let scope: PushScope
}
// Adapted Meloming PushNotificationManager register/reregister/clear responsibilities.
// Caller confines reducer to one actor; a token callback cannot assert API success.
struct PushLifecycle: Sendable {
    private var scope: PushScope?
    private var permission = PushPermission.unknown
    private var ticket: PushTicket?
    private var token: DevicePushToken?
    private var available = false
    private(set) var state = PushRegistrationState.inactive
    mutating func bind(scope: PushScope?, permission: PushPermission, serverRegistrationAvailable: Bool) {
        if self.scope != scope || self.permission != permission || available != serverRegistrationAvailable {
            ticket = nil; token = nil
            self.scope = scope; self.permission = permission; available = serverRegistrationAvailable
            if scope == nil || permission != .authorized { state = .inactive }
            else { state = available ? .retryRequired : .unavailable }
        }
    }
    mutating func beginTokenFetch() -> PushTicket? {
        guard let scope, permission == .authorized, available else { return nil }
        let request = PushTicket(id: UUID(), scope: scope)
        ticket = request; token = nil; state = .fetching
        return request
    }
    mutating func tokenReceived(_ request: PushTicket, value: DevicePushToken) -> Bool {
        guard current(request), state == .fetching else { return false }
        token = value; state = .registering
        return true
    }
    func registrationToken(_ request: PushTicket) -> DevicePushToken? {
        current(request) && state == .registering ? token : nil
    }
    mutating func registered(_ request: PushTicket) -> Bool {
        guard current(request), state == .registering else { return false }
        ticket = nil; token = nil; state = .registered
        return true
    }
    mutating func failed(_ request: PushTicket) -> Bool {
        guard current(request) else { return false }
        ticket = nil; token = nil; state = .retryRequired
        return true
    }
    private func current(_ request: PushTicket) -> Bool {
        ticket == request && scope == request.scope && permission == .authorized && available
    }
}
