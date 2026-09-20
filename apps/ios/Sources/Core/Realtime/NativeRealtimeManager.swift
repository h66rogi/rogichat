import Foundation
import Combine

// The SDK bridge exposes only read-only callbacks, never application emit/join.
@MainActor protocol RealtimeSocketDriver: AnyObject {
    func onConnected(_ callback: @escaping @MainActor () -> Void)
    func onDisconnected(_ callback: @escaping @MainActor () -> Void)
    func onError(_ callback: @escaping @MainActor () -> Void)
    func onSyncRequired(_ callback: @escaping @MainActor (String) -> Void)
    func connect()
    func removeAllHandlers()
    func disconnect()
}
@MainActor protocol RealtimeSocketFactory {
    func create(options: RealtimeConnectionOptions) throws -> any RealtimeSocketDriver
}
enum RealtimeEvent: Sendable {
    case syncRequired(RealtimeScope), revalidationRequired(RealtimeTicket)
}

// Modified reuse of Meloming SongLiveSocketManager: retained driver, eventSubject,
// weak callback capture, connect/setupEventHandlers/disconnect/reconnect ownership.
// No join/identifier/raw event payload. Every reconnect needs current REST authority.
@MainActor final class NativeRealtimeManager: ObservableObject {
    @Published private(set) var connectionStatus = RealtimeStatus.disconnected
    private var socket: (any RealtimeSocketDriver)?
    private let factory: any RealtimeSocketFactory
    private var lifecycle = RealtimeLifecycle()
    private let eventSubject = PassthroughSubject<RealtimeEvent, Never>()
    var events: AnyPublisher<RealtimeEvent, Never> { eventSubject.eraseToAnyPublisher() }
    init(factory: any RealtimeSocketFactory) { self.factory = factory }
    func bind(scope: RealtimeScope?, foreground: Bool) {
        if lifecycle.bind(scope: scope, foreground: foreground) { disposeSocket(); connectionStatus = lifecycle.status }
    }
    func connect(scope: RealtimeScope, bearer: String) {
        guard let ticket = lifecycle.begin(expected: scope) else { return }
        disposeSocket(); connectionStatus = lifecycle.status
        do {
            let socket = try factory.create(options: RealtimeConnectionOptions(scope: scope, bearer: bearer))
            self.socket = socket
            setupEventHandlers(socket: socket, ticket: ticket)
            socket.connect()
        } catch { lost(ticket) }
    }
    func reconnect(ticket: RealtimeTicket, bearer: String) {
        guard lifecycle.canReconnect(ticket) else { return }
        connect(scope: ticket.scope, bearer: bearer)
    }
    func disconnect() { bind(scope: nil, foreground: false) }
    private func disposeSocket() {
        let previous = socket; socket = nil
        previous?.removeAllHandlers(); previous?.disconnect()
    }
    private func setupEventHandlers(socket: any RealtimeSocketDriver, ticket: RealtimeTicket) {
        socket.onConnected { [weak self] in
            guard let self, lifecycle.connected(ticket) else { return }
            connectionStatus = lifecycle.status
            eventSubject.send(.syncRequired(ticket.scope))
        }
        socket.onDisconnected { [weak self] in self?.lost(ticket) }
        socket.onError { [weak self] in self?.lost(ticket) }
        socket.onSyncRequired { [weak self] payload in
            guard let self, lifecycle.wake(ticket, payload: payload) else { return }
            eventSubject.send(.syncRequired(ticket.scope))
        }
    }
    private func lost(_ ticket: RealtimeTicket) {
        guard lifecycle.disconnected(ticket) else { return }
        disposeSocket(); connectionStatus = lifecycle.status
        eventSubject.send(.revalidationRequired(ticket))
    }
    isolated deinit {
        socket?.removeAllHandlers()
        socket?.disconnect()
    }
}
