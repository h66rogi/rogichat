import Foundation
#if canImport(RogichatRooms)
import RogichatRooms
#endif

typealias ConversationEndpoint = ConversationRequest
extension ConversationRequest {
    func request(environment: NativeEnvironment, credential: NativeCredential, scope: ConversationScope) throws -> URLRequest {
        try scope.check()
        guard credential.isValid, credential.environment == environment else { throw ProductError.secureStorage }
        let path: String
        var query: [URLQueryItem] = []
        var body: Data?
        switch self {
        case .send(let command):
            guard command.roomID == scope.room.id, command.membershipScope == scope.room.membershipScope else { throw ConversationError.staleScope }
            path = "rooms/\(scope.room.id)/messages"; body = try command.requestBody()
        case .read(let endpoint):
            let suffix: String
            switch endpoint {
            case .snapshot: suffix = "snapshot"
            case .events(let cursor): suffix = "events"; guard RoomsWire.cursor(cursor) else { throw ConversationError.invalidResponse }; query.append(URLQueryItem(name: "cursor", value: cursor))
            case .history(let cursor): suffix = "history"; guard RoomsWire.cursor(cursor) else { throw ConversationError.invalidResponse }; query.append(URLQueryItem(name: "cursor", value: cursor))
            case .profiles(let cursor):
                suffix = "profile-sync"
                if let cursor { guard RoomsWire.cursor(cursor) else { throw ConversationError.invalidResponse }; query.append(URLQueryItem(name: "cursor", value: cursor)) }
            case .recipients(let after):
                suffix = "private-recipients"
                if let after { guard RoomsWire.uuid(after) else { throw ConversationError.invalidResponse }; query.append(URLQueryItem(name: "after", value: after)) }
            case .receipt(let id): guard RoomsWire.uuid(id) else { throw ConversationError.invalidResponse }; suffix = "message-commands/\(id)"
            case .message(let id): guard RoomsWire.uuid(id) else { throw ConversationError.invalidResponse }; suffix = "messages/\(id)"
            }
            path = "rooms/\(scope.room.id)/\(suffix)"
            switch endpoint {
            case .snapshot, .events, .history, .profiles:
                let cache: String; let limit: String
                if case .profiles = endpoint { cache = scope.profileCacheID; limit = "100" }
                else { cache = scope.cacheID; limit = "20" }
                query += [URLQueryItem(name: "deviceId", value: scope.deviceID), URLQueryItem(name: "cacheId", value: cache), URLQueryItem(name: "limit", value: limit)]
            default: break
            }
        }
        var components = URLComponents(url: environment.baseURL.appendingPathComponent(path), resolvingAgainstBaseURL: false)!
        if !query.isEmpty { components.queryItems = query }
        var request = URLRequest(url: components.url!)
        request.httpMethod = body == nil ? "GET" : "POST"; request.httpBody = body
        request.cachePolicy = .reloadIgnoringLocalCacheData; request.httpShouldHandleCookies = false
        request.setValue("Bearer \(credential.token)", forHTTPHeaderField: "Authorization")
        request.setValue("ios", forHTTPHeaderField: "X-Rogi-Client")
        request.setValue("application/json", forHTTPHeaderField: "Accept")
        if body != nil { request.setValue("application/json", forHTTPHeaderField: "Content-Type") }
        return request
    }
    var isSending: Bool { if case .send = self { true } else { false } }
    static func error(data: Data, status: Int, writing: Bool = false) -> any Error {
        struct Failure: Decodable { struct Detail: Decodable { let code: String }; let error: Detail }
        let code = try? JSONDecoder().decode(Failure.self, from: data).error.code
        if status == 401 { return ProductError.unauthenticated }
        if status == 403 && code == "SOOP_LINK_REQUIRED" { return ProductError.linkRequired }
        if status == 403 { return ConversationError.forbidden }
        if status == 404 { return ConversationError.notFound }
        if status == 409 && code == "MEMBERSHIP_SCOPE_MISMATCH" { return ConversationError.membershipChanged }
        if status == 409 { return ConversationError.conflict }
        if status == 400 || status == 413 { return writing ? ConversationError.invalidText : ConversationError.invalidResponse }
        return ConversationError.unavailable
    }
}
protocol ConversationRequesting: Sendable {
    func performConversation(_ endpoint: ConversationEndpoint, credential: NativeCredential, scope: ConversationScope) async throws -> Data
}
