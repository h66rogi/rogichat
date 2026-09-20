import Foundation
#if canImport(RogichatRooms)
import RogichatRooms
#endif

typealias RoomsEndpoint = RoomsQuery
extension RoomsQuery {
    func request(environment: NativeEnvironment, credential: NativeCredential) throws -> URLRequest {
        guard credential.isValid, credential.environment == environment else { throw ProductError.secureStorage }
        let path: String
        var query: [URLQueryItem] = []
        switch self {
        case .discovery(let after):
            path = "rooms"
            if let after { guard RoomsWire.uuid(after) else { throw RoomsError.invalidResponse }; query.append(URLQueryItem(name: "after", value: after)) }
        case .manifest(let device, let cache, let cursor):
            guard RoomsWire.uuid(device), RoomsWire.uuid(cache), cursor.map(RoomsWire.cursor) ?? true else { throw RoomsError.invalidResponse }
            path = "sync"; query = [URLQueryItem(name: "deviceId", value: device), URLQueryItem(name: "cacheId", value: cache), URLQueryItem(name: "limit", value: "100")]
            if let cursor { query.append(URLQueryItem(name: "cursor", value: cursor)) }
        }
        var components = URLComponents(url: environment.baseURL.appendingPathComponent(path), resolvingAgainstBaseURL: false)!
        if !query.isEmpty { components.queryItems = query }
        var request = URLRequest(url: components.url!)
        request.httpMethod = "GET"; request.cachePolicy = .reloadIgnoringLocalCacheData; request.httpShouldHandleCookies = false
        request.setValue("Bearer \(credential.token)", forHTTPHeaderField: "Authorization")
        request.setValue("ios", forHTTPHeaderField: "X-Rogi-Client")
        request.setValue("application/json", forHTTPHeaderField: "Accept")
        return request
    }
    static func error(data: Data, status: Int) -> any Error {
        struct Failure: Decodable { struct Code: Decodable { let code: String }; let error: Code }
        let code = try? JSONDecoder().decode(Failure.self, from: data).error.code
        if status == 401 { return ProductError.unauthenticated }
        if status == 403 && code == "SOOP_LINK_REQUIRED" { return ProductError.linkRequired }
        if status == 403 { return RoomsError.forbidden }
        if status == 404 || status == 503 { return RoomsError.unavailable }
        if status >= 500 || status == 408 || status == 429 { return RoomsError.connection }
        return RoomsError.invalidResponse
    }
}
protocol RoomsRequesting: Sendable { func performRooms(_ endpoint: RoomsEndpoint, credential: NativeCredential, scope: RoomsScope) async throws -> Data }
