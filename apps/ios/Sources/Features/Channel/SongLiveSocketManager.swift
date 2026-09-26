import Foundation
import SocketIO
import Combine

enum ConsoleSocketEvent {
    case connected
    case disconnected
    case reconnecting
    case joined(session: LiveSession?)
    case sessionStarted(sessionId: Int)
    case sessionEnded(sessionId: Int)
    case settingsUpdated(sessionId: Int)
    case requestAdded(sessionId: Int)
    case requestUpdated(sessionId: Int)
    case requestRemoved(sessionId: Int, requestId: Int?)
    case queueReordered(sessionId: Int)
}

enum ConnectionStatus {
    case connected
    case disconnected
    case reconnecting
}

@MainActor
final class SongLiveSocketManager: ObservableObject {
    @Published var connectionStatus: ConnectionStatus = .disconnected

    private var manager: SocketManager?
    private var socket: SocketIOClient?
    private var identifier: String?
    private let eventSubject = PassthroughSubject<ConsoleSocketEvent, Never>()

    var events: AnyPublisher<ConsoleSocketEvent, Never> {
        eventSubject.eraseToAnyPublisher()
    }

    func connect(identifier: String) {
        self.identifier = identifier
        disconnect()

        let url = ChannelEnvironment.apiOrigin

        let manager = SocketManager(
            socketURL: url,
            config: [
                .log(false),
                .forceWebsockets(false),
                .reconnects(true),
                .reconnectWait(1),
                .reconnectWaitMax(30),
                .path("/socket.io"),
            ]
        )

        self.manager = manager
        let socket = manager.socket(forNamespace: "/song-live")
        self.socket = socket

        setupEventHandlers(socket: socket, identifier: identifier)
        socket.connect()
    }

    func disconnect() {
        socket?.disconnect()
        socket?.removeAllHandlers()
        manager?.disconnect()
        manager = nil
        socket = nil
        connectionStatus = .disconnected
    }

    func reconnect() {
        guard let identifier = identifier else { return }
        connect(identifier: identifier)
    }

    private func setupEventHandlers(socket: SocketIOClient, identifier: String) {
        socket.on(clientEvent: .connect) { [weak self] _, _ in
            Task { @MainActor in
                self?.connectionStatus = .connected
                self?.eventSubject.send(.connected)
                socket.emit("join", ["identifier": identifier])
            }
        }

        socket.on(clientEvent: .disconnect) { [weak self] _, _ in
            Task { @MainActor in
                self?.connectionStatus = .disconnected
                self?.eventSubject.send(.disconnected)
            }
        }

        socket.on(clientEvent: .error) { _, _ in }

        socket.on(clientEvent: .reconnect) { [weak self] _, _ in
            Task { @MainActor in
                self?.connectionStatus = .reconnecting
                self?.eventSubject.send(.reconnecting)
            }
        }

        socket.on(clientEvent: .reconnectAttempt) { [weak self] _, _ in
            Task { @MainActor in
                self?.connectionStatus = .reconnecting
            }
        }

        socket.on("joined") { [weak self] data, _ in
            let session: LiveSession?
            if let dict = data.first as? [String: Any],
               let sessionDict = dict["session"] as? [String: Any],
               let jsonData = try? JSONSerialization.data(withJSONObject: sessionDict),
               let dto = try? JSONDecoder().decode(LiveSessionDTO.self, from: jsonData) {
                session = dto.toDomain()
            } else {
                session = nil
            }
            Task { @MainActor in
                self?.eventSubject.send(.joined(session: session))
            }
        }

        socket.on("error") { _, _ in }

        let sessionEvents: [(String, (Int, Int?) -> ConsoleSocketEvent)] = [
            ("session.started", { id, _ in .sessionStarted(sessionId: id) }),
            ("session.ended", { id, _ in .sessionEnded(sessionId: id) }),
            ("settings.updated", { id, _ in .settingsUpdated(sessionId: id) }),
            ("request.added", { id, _ in .requestAdded(sessionId: id) }),
            ("request.updated", { id, _ in .requestUpdated(sessionId: id) }),
            ("request.removed", { id, reqId in .requestRemoved(sessionId: id, requestId: reqId) }),
            ("queue.reordered", { id, _ in .queueReordered(sessionId: id) }),
        ]

        for (eventName, factory) in sessionEvents {
            socket.on(eventName) { [weak self] data, _ in
                let sessionId: Int
                let requestId: Int?

                if let dict = data.first as? [String: Any] {
                    sessionId = dict["sessionId"] as? Int ?? 0
                    requestId = dict["requestId"] as? Int
                } else if let id = data.first as? Int {
                    sessionId = id
                    requestId = nil
                } else {
                    return
                }

                let event = factory(sessionId, requestId)
                Task { @MainActor in
                    self?.eventSubject.send(event)
                }
            }
        }
    }

    isolated deinit {
        socket?.disconnect()
        socket?.removeAllHandlers()
        manager?.disconnect()
    }
}
