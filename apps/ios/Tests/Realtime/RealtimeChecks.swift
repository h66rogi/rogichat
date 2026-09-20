import Foundation
import Combine

@MainActor private final class TestSocket: RealtimeSocketDriver {
    var connected: (() -> Void)?
    var disconnected: (() -> Void)?
    var error: (() -> Void)?
    var wake: ((String) -> Void)?
    var connects = 0
    var disconnects = 0
    func onConnected(_ callback: @escaping @MainActor () -> Void) { connected = callback }
    func onDisconnected(_ callback: @escaping @MainActor () -> Void) { disconnected = callback }
    func onError(_ callback: @escaping @MainActor () -> Void) { error = callback }
    func onSyncRequired(_ callback: @escaping @MainActor (String) -> Void) { wake = callback }
    func connect() { connects += 1 }
    func removeAllHandlers() { connected = nil; disconnected = nil; error = nil; wake = nil }
    func disconnect() { disconnects += 1 }
}
@MainActor private final class TestFactory: RealtimeSocketFactory {
    var sockets: [TestSocket] = []
    func create(options: RealtimeConnectionOptions) throws -> any RealtimeSocketDriver {
        precondition(options.path == "/v1/realtime" && options.namespace == "/" && !options.reconnects && options.forceWebSockets)
        precondition(options.headers["X-Rogi-Client"] == "ios" && options.headers["Cookie"] == nil)
        let socket = TestSocket(); sockets.append(socket); return socket
    }
}
@main struct RealtimeChecks {
    @MainActor static func main() throws {
        func scope(_ id: String) -> RealtimeScope { RealtimeScope(environment: "qa", accountID: id, accountGeneration: "generation", sessionEpoch: UUID()) }
        let a = scope("a"), b = scope("b"), aAgain = scope("a")
        let token = String(repeating: "A", count: 43)
        let factory = TestFactory(), manager = NativeRealtimeManager(factory: TestFactory())
        manager.bind(scope: nil, foreground: true); manager.connect(scope: a, bearer: token)
        precondition(manager.connectionStatus == .disconnected)
        let live = NativeRealtimeManager(factory: factory)
        var events: [RealtimeEvent] = []
        let subscription = live.events.sink { events.append($0) }
        live.bind(scope: a, foreground: true); live.connect(scope: a, bearer: token)
        let first = factory.sockets[0], lateConnect = first.connected!, lateWake = first.wake!, lateError = first.error!
        first.wake?("{\"schemaVersion\":1}"); precondition(events.isEmpty)
        first.connected?(); precondition(events.count == 1 && live.connectionStatus == .connected)
        first.connected?(); precondition(events.count == 1)
        first.wake?("{\"schemaVersion\":1}"); precondition(events.count == 2)
        for invalid in ["{}", "{\"schemaVersion\":true}", "{\"schemaVersion\":\"1\"}", "{\"schemaVersion\":1,\"roomId\":\"x\"}", "{\"schemaVersion\":1,\"schemaVersion\":1}"] {
            first.wake?(invalid); precondition(events.count == 2)
        }
        first.disconnected?(); precondition(events.count == 3 && first.disconnects > 0)
        guard case .revalidationRequired(let retry) = events.last! else { preconditionFailure("Missing revalidation") }
        lateError(); precondition(events.count == 3)
        live.reconnect(ticket: retry, bearer: token)
        precondition(factory.sockets.count == 2)
        live.reconnect(ticket: retry, bearer: token); precondition(factory.sockets.count == 2)
        lateConnect(); lateWake("{\"schemaVersion\":1}"); precondition(events.count == 3)
        let second = factory.sockets[1], lateSecond = second.connected!
        live.bind(scope: b, foreground: true); live.bind(scope: aAgain, foreground: true)
        lateSecond(); precondition(events.count == 3 && second.disconnects > 0)
        live.connect(scope: a, bearer: token); precondition(factory.sockets.count == 2)
        live.connect(scope: aAgain, bearer: token)
        let third = factory.sockets[2], lateThird = third.connected!
        live.bind(scope: aAgain, foreground: false); lateThird()
        precondition(events.count == 3 && third.disconnects > 0)
        live.connect(scope: aAgain, bearer: token); precondition(factory.sockets.count == 3)
        live.disconnect(); subscription.cancel()
        var disposable: NativeRealtimeManager? = NativeRealtimeManager(factory: factory)
        disposable!.bind(scope: aAgain, foreground: true)
        disposable!.connect(scope: aAgain, bearer: token)
        let released = factory.sockets.last!
        disposable = nil
        precondition(released.disconnects > 0)
        print("Realtime lifecycle, reconnect, payload and stale callback checks passed")
    }
}
