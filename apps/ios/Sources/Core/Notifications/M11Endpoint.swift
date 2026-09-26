import Foundation

// Adapted APIEndpoint's closed notification request/body responsibility. Native
// opt-in and provider registration are deliberately not representable here.
enum M11Endpoint: Sendable {
    case enableNotifications(PreferenceGeneration)
    case notificationPreferences
    case notificationInbox(cursor: String?)
    case markNotificationRead(id: String)
    case disableNotifications(DisableAccountNotifications)
    case readState(room: ReadStateID)
    case reportReadState(room: ReadStateID, input: ReportOwnReadState)
    func request(environment: NativeEnvironment, credential: NativeCredential) throws -> URLRequest {
        guard credential.isValid, credential.environment == environment else { throw ProductError.secureStorage }
        let path: String
        let body: Data?
        switch self {
        case .enableNotifications(let expected):
            struct Input: Encodable { let pushEnabled = true; let expectedGeneration: PreferenceGeneration }
            path = "me/notification-preferences"; body = try JSONEncoder().encode(Input(expectedGeneration: expected))
        case .notificationPreferences: path = "me/notification-preferences"; body = nil
        case .notificationInbox(let cursor):
            guard cursor == nil || (cursor!.utf8.count <= 160 && cursor!.range(of: "^[A-Za-z0-9_-]+$", options: .regularExpression) != nil) else { throw ProductError.invalidResponse }
            path = "me/notifications"; body = nil
        case .markNotificationRead(let id):
            guard NativePushContract.uuid(id) else { throw ProductError.invalidResponse }
            path = "me/notifications/\(id)/read"; body = Data("{}".utf8)
        case .disableNotifications(let input): path = "me/notification-preferences"; body = try JSONEncoder().encode(input)
        case .readState(let room): path = "rooms/\(room.value)/read-state"; body = nil
        case .reportReadState(let room, let input): path = "rooms/\(room.value)/read-state"; body = try JSONEncoder().encode(input)
        }
        var request = URLRequest(url: environment.baseURL.appendingPathComponent(path))
        if case .notificationInbox(let cursor) = self {
            var components = URLComponents(url: request.url!, resolvingAgainstBaseURL: false)!
            components.queryItems = [URLQueryItem(name: "limit", value: "20")] + (cursor.map { [URLQueryItem(name: "cursor", value: $0)] } ?? [])
            request.url = components.url
        }
        if case .markNotificationRead = self { request.httpMethod = "POST" }
        else { request.httpMethod = body == nil ? "GET" : "PUT" }
        request.httpBody = body
        request.cachePolicy = .reloadIgnoringLocalCacheData; request.httpShouldHandleCookies = false
        request.setValue("Bearer \(credential.token)", forHTTPHeaderField: "Authorization")
        request.setValue("ios", forHTTPHeaderField: "X-Rogi-Client")
        request.setValue("application/json", forHTTPHeaderField: "Accept")
        if body != nil { request.setValue("application/json", forHTTPHeaderField: "Content-Type") }
        return request
    }
    var successStatus: Int { if case .markNotificationRead = self { 204 } else { 200 } }
}
protocol M11Requesting: Sendable {
    func performM11(_ endpoint: M11Endpoint, credential: NativeCredential) async throws -> Data
    func performM11(_ endpoint: M11Endpoint, credential: NativeCredential, admission: NativeRequestAdmission) async throws -> Data
}
extension M11Requesting {
    func performM11(_ endpoint: M11Endpoint, credential: NativeCredential, admission: NativeRequestAdmission) async throws -> Data {
        try await admission.validate(); return try await performM11(endpoint, credential: credential)
    }
}
// These read-state DTO/routes are a closed transport surface only. C05/C06 must
// bind actual displayed messages and room/context lifetime before any UI calls it.
