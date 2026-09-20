import Foundation
@preconcurrency import SocketIO

@MainActor struct SocketIORealtimeFactory: RealtimeSocketFactory {
    func create(options: RealtimeConnectionOptions) throws -> any RealtimeSocketDriver {
        SocketIORealtimeDriver(options: options)
    }
}

// Modified reuse of Meloming's actual manager/client allocation and SDK event hooks.
// Transport override is necessary: the default SDK engine adds shared cookies/Origin.
@MainActor private final class SocketIORealtimeDriver: RealtimeSocketDriver {
    private let manager: SocketManager
    private let socket: SocketIOClient
    init(options: RealtimeConnectionOptions) {
        manager = SocketManager(socketURL: options.origin, config: [
            .log(false), .forceWebsockets(true), .reconnects(false), .handleQueue(.main),
            .path(options.path), .version(.three)
        ])
        manager.engine = CookieFreeSocketEngine(client: manager, url: options.origin, options: ["extraHeaders": options.headers])
        socket = manager.defaultSocket
    }
    func onConnected(_ callback: @escaping @MainActor () -> Void) {
        socket.on(clientEvent: .connect) { _, _ in Task { @MainActor in callback() } }
    }
    func onDisconnected(_ callback: @escaping @MainActor () -> Void) {
        socket.on(clientEvent: .disconnect) { _, _ in Task { @MainActor in callback() } }
    }
    func onError(_ callback: @escaping @MainActor () -> Void) {
        socket.on(clientEvent: .error) { _, _ in Task { @MainActor in callback() } }
    }
    func onSyncRequired(_ callback: @escaping @MainActor (String) -> Void) {
        socket.on("sync.required") { data, _ in
            guard data.count == 1, let body = data.first as? [String: Any], body.count == 1,
                  JSONSerialization.isValidJSONObject(body), let bytes = try? JSONSerialization.data(withJSONObject: body),
                  bytes.count <= 128, let payload = String(data: bytes, encoding: .utf8) else { return }
            Task { @MainActor in callback(payload) }
        }
    }
    func connect() { socket.connect(withPayload: ["schemaVersion": 1, "transport": "native"]) }
    func removeAllHandlers() { socket.removeAllHandlers() }
    func disconnect() { socket.disconnect(); manager.disconnect() }
    isolated deinit {
        socket.removeAllHandlers(); socket.disconnect(); manager.disconnect()
    }
}
