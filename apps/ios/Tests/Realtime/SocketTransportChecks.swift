import Foundation

// Loopback-only isolated transport test. The production request builder still
// rejects arbitrary origins; only this test rewrites the prepared request URL.
@main struct SocketTransportChecks {
    static func main() async throws {
        guard CommandLine.arguments.count == 3, let loopback = URL(string: CommandLine.arguments[1]),
              loopback.host == "127.0.0.1", loopback.scheme == "ws" else { fatalError("invalid test endpoint") }
        let cookie = HTTPCookie(properties: [.domain: "127.0.0.1", .path: "/", .name: "rogi-realtime-test-" + UUID().uuidString, .value: "test-only"])!
        HTTPCookieStorage.shared.setCookie(cookie)
        defer { HTTPCookieStorage.shared.deleteCookie(cookie) }
        var request = try RealtimeWebSocketRequest.make(origin: URL(string: "https://api.qa.rogi.chat")!,
            headers: ["Authorization": "Bearer " + String(repeating: "A", count: 43), "X-Rogi-Client": "ios"])
        request.url = loopback
        let session = URLSession(configuration: RealtimeWebSocketRequest.configuration(), delegate: RealtimeRejectRedirects(), delegateQueue: nil)
        defer { session.invalidateAndCancel() }
        let socket = session.webSocketTask(with: request)
        socket.maximumMessageSize = 1024
        socket.resume()
        defer { socket.cancel(with: .goingAway, reason: nil) }
        if CommandLine.arguments[2] == "redirect" {
            do { _ = try await socket.receive(); fatalError("redirect unexpectedly connected") }
            catch { print("Redirect transport rejected") }
        } else {
            guard case .string("2") = try await socket.receive() else { fatalError("invalid test packet") }
            try await socket.send(.string("3"))
            print("Loopback WebSocket transport completed")
        }
    }
}
