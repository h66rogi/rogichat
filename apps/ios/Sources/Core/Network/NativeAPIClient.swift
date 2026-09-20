import Foundation
#if canImport(RogichatRooms)
import RogichatRooms
#endif

// Adapted from Meloming APIClient: actor-owned URLSession, bounded timeouts,
// response decoding and HTTP status handling. Native auth has no refresh path.
enum NativeEnvironment: String, Codable, Sendable {
    case qa, prod
    var baseURL: URL { URL(string: self == .qa ? "https://api.qa.rogi.chat/v1/" : "https://api.rogi.chat/v1/")! }
    var keychainService: String { (self == .qa ? "chat.rogi.rogichat.qa" : "chat.rogi.rogichat") + ".session" }
}
enum NativeEndpoint: Sendable {
    case session, profile, updateProfile(ProfileUpdate), logout
    var path: String {
        switch self { case .session: "auth/session"; case .profile, .updateProfile: "me/profile"; case .logout: "auth/logout" }
    }
    var method: String {
        switch self { case .session, .profile: "GET"; case .updateProfile: "PATCH"; case .logout: "POST" }
    }
    var successStatus: Int { if case .logout = self { 204 } else { 200 } }
    func request(environment: NativeEnvironment, credential: NativeCredential) throws -> URLRequest {
        guard credential.isValid, credential.environment == environment else { throw ProductError.secureStorage }
        var request = URLRequest(url: environment.baseURL.appendingPathComponent(path))
        request.httpMethod = method
        request.cachePolicy = .reloadIgnoringLocalCacheData
        request.httpShouldHandleCookies = false
        request.setValue("Bearer \(credential.token)", forHTTPHeaderField: "Authorization")
        request.setValue("ios", forHTTPHeaderField: "X-Rogi-Client")
        request.setValue("application/json", forHTTPHeaderField: "Accept")
        switch self {
        case .updateProfile(let update):
            guard update.isValid else { throw ProductError.invalidResponse }
            request.httpBody = try JSONEncoder().encode(update)
        case .logout: request.httpBody = Data("{}".utf8)
        default: break
        }
        if request.httpBody != nil { request.setValue("application/json", forHTTPHeaderField: "Content-Type") }
        return request
    }
}
protocol NativeRequesting: Sendable {
    func perform(_ endpoint: NativeEndpoint, credential: NativeCredential) async throws -> Data
}
final class NativeSessionDelegate: NSObject, URLSessionTaskDelegate, Sendable {
    // Never forward a native credential to a redirect destination, including the same host.
    func urlSession(_ session: URLSession, task: URLSessionTask, willPerformHTTPRedirection response: HTTPURLResponse,
                    newRequest request: URLRequest, completionHandler: @escaping @Sendable (URLRequest?) -> Void) {
        completionHandler(nil)
    }
    func urlSession(_ session: URLSession, task: URLSessionTask, didReceive challenge: URLAuthenticationChallenge,
                    completionHandler: @escaping @Sendable (URLSession.AuthChallengeDisposition, URLCredential?) -> Void) {
        if challenge.protectionSpace.authenticationMethod == NSURLAuthenticationMethodServerTrust {
            completionHandler(.performDefaultHandling, nil)
        } else { completionHandler(.cancelAuthenticationChallenge, nil) }
    }
}
actor NativeAPIClient: NativeRequesting, SOOPRequesting, M11Requesting, RoomsRequesting, RoomsCommandRequesting {
    private let environment: NativeEnvironment
    private let session: URLSession
    init(environment: NativeEnvironment) {
        self.environment = environment
        self.session = URLSession(configuration: Self.configuration(), delegate: NativeSessionDelegate(), delegateQueue: nil)
    }
    deinit { session.invalidateAndCancel() }
    static func configuration() -> URLSessionConfiguration {
        let config = URLSessionConfiguration.ephemeral
        config.timeoutIntervalForRequest = 30
        config.timeoutIntervalForResource = 60
        config.requestCachePolicy = .reloadIgnoringLocalCacheData
        config.urlCache = nil
        config.httpCookieStorage = nil
        config.httpShouldSetCookies = false
        config.urlCredentialStorage = nil
        return config
    }
    func perform(_ endpoint: NativeEndpoint, credential: NativeCredential) async throws -> Data {
        let request = try endpoint.request(environment: environment, credential: credential)
        do {
            let (bytes, response) = try await session.bytes(for: request)
            defer { bytes.task.cancel() }
            try Task.checkCancellation()
            guard let response = response as? HTTPURLResponse, response.url == request.url else { throw ProductError.invalidResponse }
            // An authoritative status does not require consuming an arbitrary body.
            if response.statusCode == 401 { throw ProductError.unauthenticated }
            guard response.expectedContentLength <= Int64(Self.maximumBodyBytes) else { throw ProductError.invalidResponse }
            let data = try await Self.readBody(bytes, cancel: { bytes.task.cancel() })
            try Task.checkCancellation()
            return try Self.validated(data, status: response.statusCode, expected: endpoint.successStatus)
        } catch let error as ProductError { throw error }
        catch {
            if Task.isCancelled || error is CancellationError || (error as? URLError)?.code == .cancelled { throw CancellationError() }
            throw ProductError.connection
        }
    }
    func performSOOP(_ input: SOOPRequest, credential: NativeCredential?) async throws -> Data {
        let request = try input.request(environment: environment, credential: credential)
        do {
            let (bytes, response) = try await session.bytes(for: request)
            defer { bytes.task.cancel() }
            guard let response = response as? HTTPURLResponse, response.url == request.url,
                  response.expectedContentLength <= Int64(Self.maximumBodyBytes) else { throw ProductError.invalidResponse }
            let data = try await Self.readBody(bytes, cancel: { bytes.task.cancel() })
            // Auth endpoints need their scoped code even for 401; they never clear a store.
            guard response.statusCode == 200 else { throw SOOPAuthError.response(data, status: response.statusCode) }
            return data
        } catch let error as SOOPAuthError { throw error }
        catch let error as ProductError { throw error }
        catch {
            if Task.isCancelled || error is CancellationError || (error as? URLError)?.code == .cancelled { throw CancellationError() }
            throw ProductError.connection
        }
    }
    func performM11(_ endpoint: M11Endpoint, credential: NativeCredential) async throws -> Data {
        let request = try endpoint.request(environment: environment, credential: credential)
        do {
            let (bytes, response) = try await session.bytes(for: request)
            defer { bytes.task.cancel() }
            try Task.checkCancellation()
            guard let response = response as? HTTPURLResponse, response.url == request.url else { throw ProductError.invalidResponse }
            if response.statusCode == 401 { throw ProductError.unauthenticated }
            guard response.expectedContentLength <= Int64(Self.maximumBodyBytes) else { throw ProductError.invalidResponse }
            let data = try await Self.readBody(bytes, cancel: { bytes.task.cancel() })
            try Task.checkCancellation()
            guard response.statusCode == 200 else { throw M11Error.response(data, status: response.statusCode) }
            return data
        } catch let error as M11Error { throw error }
        catch let error as ProductError { throw error }
        catch {
            if Task.isCancelled || error is CancellationError || (error as? URLError)?.code == .cancelled { throw CancellationError() }
            throw ProductError.connection
        }
    }
    func performRooms(_ endpoint: RoomsEndpoint, credential: NativeCredential, scope: RoomsScope) async throws -> Data {
        try scope.check() // Repeat at this actor's admission, not only in the caller.
        let request = try endpoint.request(environment: environment, credential: credential)
        do {
            let (bytes, response) = try await session.bytes(for: request)
            defer { bytes.task.cancel() }
            try scope.check()
            guard let response = response as? HTTPURLResponse, response.url == request.url else { throw RoomsError.invalidResponse }
            if response.statusCode == 401 { throw ProductError.unauthenticated }
            guard response.expectedContentLength <= Int64(Self.maximumBodyBytes) else { throw RoomsError.invalidResponse }
            let data = try await Self.readBody(bytes, cancel: { bytes.task.cancel() })
            try scope.check()
            guard response.statusCode == 200 else { throw RoomsEndpoint.error(data: data, status: response.statusCode) }
            return data
        } catch let error as RoomsError { throw error }
        catch let error as ProductError { throw error }
        catch {
            if Task.isCancelled || error is CancellationError || (error as? URLError)?.code == .cancelled { throw CancellationError() }
            throw RoomsError.connection
        }
    }
    func performRoomsCommand(_ endpoint: RoomsCommandEndpoint, credential: NativeCredential, scope: RoomsScope) async throws -> Data {
        try scope.check()
        let request = try endpoint.request(environment: environment, credential: credential)
        do {
            let (bytes, response) = try await session.bytes(for: request)
            defer { bytes.task.cancel() }
            try scope.check()
            guard let response = response as? HTTPURLResponse, response.url == request.url else { throw RoomsError.invalidResponse }
            if response.statusCode == 401 { throw ProductError.unauthenticated }
            guard response.expectedContentLength <= Int64(Self.maximumBodyBytes) else { throw RoomsError.invalidResponse }
            let data = try await Self.readBody(bytes, cancel: { bytes.task.cancel() })
            try scope.check()
            return try endpoint.validated(data, status: response.statusCode)
        } catch let error as RoomCommandError { throw error }
        catch let error as RoomsError { throw error }
        catch let error as ProductError { throw error }
        catch {
            if Task.isCancelled || error is CancellationError || (error as? URLError)?.code == .cancelled { throw CancellationError() }
            throw RoomsError.connection
        }
    }
    func revokeSOOPCredential(_ credential: NativeCredential) async { _ = try? await perform(.logout, credential: credential) }
    static let maximumBodyBytes = 1_048_576
    static func readBody<S: AsyncSequence & Sendable>(_ bytes: S, limit: Int = maximumBodyBytes,
                                                     cancel: @Sendable () -> Void) async throws -> Data where S.Element == UInt8 {
        var data = Data()
        for try await byte in bytes {
            try Task.checkCancellation()
            guard data.count < limit else { cancel(); throw ProductError.invalidResponse }
            data.append(byte)
        }
        return data
    }
    static func validated(_ data: Data, status: Int, expected: Int) throws -> Data {
        guard data.count <= maximumBodyBytes else { throw ProductError.invalidResponse }
        if status == 401 { throw ProductError.unauthenticated }
        if status == 403 {
            struct Failure: Decodable { let error: Code?; struct Code: Decodable { let code: String } }
            // The backend's ApiError envelope has error.code, not a free-form message.
            let code = try? JSONDecoder().decode(Failure.self, from: data).error?.code
            if code == "SOOP_LINK_REQUIRED" { throw ProductError.linkRequired }
            throw ProductError.unavailable
        }
        if status >= 500 || status == 408 || status == 429 { throw ProductError.connection }
        guard status == expected else { throw ProductError.invalidResponse }
        if expected == 204, !data.isEmpty { throw ProductError.invalidResponse }
        return data
    }
}
