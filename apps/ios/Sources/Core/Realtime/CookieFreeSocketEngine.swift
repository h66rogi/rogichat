import Foundation
@preconcurrency import SocketIO
@preconcurrency import Starscream

/// Real Socket.IO engine seam, replacing only its default cookie/Origin-bearing
/// Engine.IO transport. The SDK still handles Socket.IO namespace/auth/event parsing.
/// SDK handleQueue and this engineQueue MUST both be main (set by the factory).
@MainActor final class CookieFreeSocketEngine: @preconcurrency SocketEngineSpec {
    weak var client: (any SocketEngineClient)?
    private(set) var closed = true
    var connected: Bool { !closed && wire.connected }
    let compress = false
    var connectParams: [String: Any]?
    var cookies: [HTTPCookie]? { nil }
    let engineQueue = DispatchQueue.main
    var extraHeaders: [String: String]?
    let fastUpgrade = false
    let forcePolling = false
    let forceWebsockets = true
    let polling = false
    let probing = false
    var sid: String { wire.sid }
    let socketPath = "/v1/realtime/"
    let urlPolling: URL
    var urlWebSocket: URL { (try? RealtimeWebSocketRequest.make(origin: urlPolling, headers: extraHeaders ?? [:]).url) ?? urlPolling }
    let version = SocketIOVersion.three // Engine.IO 4 / Socket.IO 3+ protocol.
    var websocket: Bool { true }
    var ws: WebSocket? { nil } // Starscream's shared-cookie engine is never instantiated.

    private var wire = NativeEngineIOState()
    private var session: URLSession?
    private var task: URLSessionWebSocketTask?
    private var reader: Task<Void, Never>?
    private var heartbeat: Task<Void, Never>?
    private var operation: UUID?
    init(client: any SocketEngineClient, url: URL, options: [String: Any]?) {
        self.client = client; urlPolling = url
        extraHeaders = options?["extraHeaders"] as? [String: String]
    }
    func connect() {
        guard closed else { return }
        closed = false; wire = NativeEngineIOState()
        let operation = UUID(); self.operation = operation
        do {
            guard connectParams == nil || connectParams?.isEmpty == true else { throw RealtimeContractError.invalid }
            let request = try RealtimeWebSocketRequest.make(origin: urlPolling, headers: extraHeaders ?? [:])
            let session = URLSession(configuration: RealtimeWebSocketRequest.configuration(), delegate: RealtimeRejectRedirects(), delegateQueue: nil)
            self.session = session
            let task = session.webSocketTask(with: request)
            task.maximumMessageSize = 1024; self.task = task
            task.resume(); armTimeout(milliseconds: 5_000)
            reader = Task { @MainActor [weak self] in
                while !Task.isCancelled {
                    do {
                        let message = try await task.receive()
                        guard let self, self.operation == operation, !closed else { return }
                        switch message {
                        case .string(let value): parseEngineMessage(value)
                        case .data: didError(reason: "invalid_packet")
                        @unknown default: didError(reason: "invalid_packet")
                        }
                    } catch {
                        guard let self, self.operation == operation else { return }
                        didError(reason: "connection_unavailable"); return
                    }
                }
            }
        } catch { didError(reason: "connection_unavailable") }
    }
    func parseEngineMessage(_ message: String) {
        guard !closed else { return }
        do {
            switch try wire.receive(message) {
            case .opened:
                armTimeout(milliseconds: wire.heartbeatMilliseconds)
                client?.engineDidOpen(reason: "connected")
            case .ping:
                armTimeout(milliseconds: wire.heartbeatMilliseconds)
                client?.engineDidReceivePing()
                send("3") { [weak self] in self?.client?.engineDidSendPong() }
            case .packet(let packet): client?.parseEngineMessage(packet)
            case .closed: disconnect(reason: "disconnected")
            case .ignored: break
            }
        } catch { didError(reason: "invalid_packet") }
    }
    func parseEngineData(_ data: Data) { didError(reason: "invalid_packet") }
    func write(_ msg: String, withType type: SocketEnginePacketType, withData data: [Data], completion: (() -> Void)?) {
        guard type == .message, data.isEmpty, wire.permittedSocketWrite(msg) else { didError(reason: "invalid_packet"); return }
        send("4" + msg, completion: completion)
    }
    private func send(_ message: String, completion: (() -> Void)? = nil) {
        guard !closed, let task, let operation else { return }
        Task { @MainActor [weak self] in
            do {
                try await task.send(.string(message))
                guard let self, self.operation == operation, !closed else { return }
                completion?()
            } catch {
                guard let self, self.operation == operation else { return }
                didError(reason: "connection_unavailable")
            }
        }
    }
    private func armTimeout(milliseconds: Int) {
        heartbeat?.cancel()
        let operation = operation
        heartbeat = Task { @MainActor [weak self] in
            do { try await Task.sleep(for: .milliseconds(milliseconds)) } catch { return }
            guard let self, self.operation == operation, !closed else { return }
            didError(reason: "connection_unavailable")
        }
    }
    func didError(reason: String) {
        guard !closed else { return }
        client?.engineDidError(reason: "realtime_unavailable")
        disconnect(reason: "realtime_unavailable")
    }
    func disconnect(reason: String) {
        guard !closed else { return }
        closed = true; operation = nil
        reader?.cancel(); reader = nil; heartbeat?.cancel(); heartbeat = nil
        task?.cancel(with: .goingAway, reason: nil); task = nil
        session?.invalidateAndCancel(); session = nil
        client?.engineDidClose(reason: "disconnected")
    }
    func doFastUpgrade() { didError(reason: "invalid_packet") }
    func flushWaitingForPostToWebSocket() { didError(reason: "invalid_packet") }
    isolated deinit {
        reader?.cancel(); heartbeat?.cancel()
        task?.cancel(with: .goingAway, reason: nil); session?.invalidateAndCancel()
    }
}
