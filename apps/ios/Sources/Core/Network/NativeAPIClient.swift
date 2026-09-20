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
// Captured account epoch and protected credential are checked at the HTTP actor,
// after every awaited OS permission query and immediately before URLSession admission.
struct NativeRequestAdmission: Sendable {
    let check: @Sendable () throws -> Void
    var permission: (@Sendable () async -> PushPermission)? = nil
    func validate() async throws {
        try Task.checkCancellation(); try check()
        if let permission, await permission() != .authorized { throw ProductError.notificationPermission }
        try Task.checkCancellation(); try check()
    }
}
protocol NativeRequesting: Sendable {
    func performAccess(_ input: AccountAccessRequest, credential: NativeCredential, admit: @escaping @Sendable () throws -> Void) async throws -> Data
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
extension NativeRequesting {
    func performAccess(_ input: AccountAccessRequest, credential: NativeCredential, admit: @escaping @Sendable () throws -> Void) async throws -> Data { throw ProductError.unavailable }
}
actor NativeAPIClient: AccountFeatureRequesting, AppleIdentityRequesting, NativePushRequesting, NativeRequesting, SOOPRequesting, M11Requesting, RoomsRequesting, RoomsCommandRequesting, AccountDeletionRequesting, ConversationRequesting {
    private let environment: NativeEnvironment
    private let session: URLSession
    init(environment: NativeEnvironment, configuration: URLSessionConfiguration? = nil) {
        self.environment = environment
        self.session = URLSession(configuration: configuration ?? Self.configuration(), delegate: NativeSessionDelegate(), delegateQueue: nil)
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
    func performAccess(_ input: AccountAccessRequest, credential: NativeCredential, admit: @escaping @Sendable () throws -> Void) async throws -> Data {
        guard credential.isValid, credential.environment == environment else { throw ProductError.secureStorage }
        let (method,path,body,status,after) = try input.wire()
        var url = URLComponents(url: environment.baseURL.appendingPathComponent(path),resolvingAgainstBaseURL:false)!
        if let after { url.queryItems = [URLQueryItem(name:"after",value:after)] }
        var request = URLRequest(url:url.url!); request.httpMethod = method; request.httpBody = body
        request.httpShouldHandleCookies = false; request.cachePolicy = .reloadIgnoringLocalCacheData
        request.setValue("Bearer \(credential.token)",forHTTPHeaderField:"Authorization")
        request.setValue("ios",forHTTPHeaderField:"X-Rogi-Client"); request.setValue("application/json",forHTTPHeaderField:"Accept")
        if body != nil { request.setValue("application/json",forHTTPHeaderField:"Content-Type") }
        try admit()
        let (bytes,response) = try await session.bytes(for:request); defer { bytes.task.cancel() }
        guard let response = response as? HTTPURLResponse, response.url == request.url, response.expectedContentLength <= Int64(Self.maximumBodyBytes) else { throw ProductError.invalidResponse }
        let data = try await Self.readBody(bytes,cancel:{ bytes.task.cancel() }); try Task.checkCancellation()
        return try Self.validated(data,status:response.statusCode,expected:status)
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
    func performApple(_ endpoint: AppleIdentityEndpoint, intent: IdentityIntent, originalCredential: NativeCredential?) async throws -> Data {
        try await performApple(endpoint, intent: intent, originalCredential: originalCredential, admit: {})
    }
    func performApple(_ endpoint: AppleIdentityEndpoint, intent: IdentityIntent, originalCredential: NativeCredential?, admit: @escaping @Sendable () throws -> Void) async throws -> Data {
        let request = try endpoint.request(environment: environment, intent: intent, originalCredential: originalCredential)
        do {
            try admit()
            let (bytes, response) = try await session.bytes(for: request)
            defer { bytes.task.cancel() }
            guard let response = response as? HTTPURLResponse, response.url == request.url, response.expectedContentLength <= Int64(Self.maximumBodyBytes) else { throw ProductError.invalidResponse }
            let data = try await Self.readBody(bytes, cancel: { bytes.task.cancel() })
            guard response.statusCode == 200 else {
                struct Failure: Decodable { struct Detail: Decodable { let code: String }; let error: Detail }
                let code = try? JSONDecoder().decode(Failure.self, from: data).error.code
                if response.statusCode == 401, code == "UNAUTHENTICATED" { throw SOOPAuthError.unauthenticated }
                if response.statusCode == 401, code == "LINK_SESSION_CHANGED" { throw SOOPAuthError.sessionChanged }
                throw AppleIdentityProblem.response(status: response.statusCode, code: code)
            }
            return data
        } catch let error as AppleIdentityProblem { throw error }
        catch let error as SOOPAuthError { throw error }
        catch let error as ProductError { throw error }
        catch { if Task.isCancelled || error is CancellationError { throw CancellationError() }; throw ProductError.connection }
    }
    func performNativePush(_ endpoint: NativePushEndpoint, credential: NativeCredential) async throws -> Data {
        try await performNativePush(endpoint, credential: credential, admission: NativeRequestAdmission(check: {}))
    }
    func performNativePush(_ endpoint: NativePushEndpoint, credential: NativeCredential, admission: NativeRequestAdmission) async throws -> Data {
        let request = try endpoint.request(environment: environment, credential: credential)
        try await admission.validate()
        try Task.checkCancellation(); try admission.check()
        let (bytes, response) = try await session.bytes(for: request)
        defer { bytes.task.cancel() }
        guard let response = response as? HTTPURLResponse, response.url == request.url, response.expectedContentLength <= Int64(Self.maximumBodyBytes) else { throw ProductError.invalidResponse }
        let data = try await Self.readBody(bytes, cancel: { bytes.task.cancel() })
        if response.statusCode == 401 { throw ProductError.unauthenticated }
        let expected: Int
        switch endpoint { case .register: expected = 201; case .remove: expected = 204; default: expected = 200 }
        guard response.statusCode == expected, expected != 204 || data.isEmpty else { throw ProductError.connection }
        return data
    }
    func performSOOP(_ input: SOOPRequest, credential: NativeCredential?) async throws -> Data {
        try await performSOOP(input, credential: credential, admit: {})
    }
    func performSOOP(_ input: SOOPRequest, credential: NativeCredential?, admit: @escaping @Sendable () throws -> Void) async throws -> Data {
        let request = try input.request(environment: environment, credential: credential)
        do {
            try admit()
            let (bytes, response) = try await session.bytes(for: request)
            defer { bytes.task.cancel() }
            guard let response = response as? HTTPURLResponse, response.url == request.url,
                  response.expectedContentLength <= Int64(Self.maximumBodyBytes) else { throw ProductError.invalidResponse }
            let data = try await Self.readBody(bytes, cancel: { bytes.task.cancel() })
            if case .password = input, response.statusCode != 200 {
                struct Failure: Decodable { struct Detail: Decodable { let code: String }; let error: Detail }
                let code = (try? JSONDecoder().decode(Failure.self,from:data))?.error.code
                if response.statusCode == 401 { if code == "UNAUTHENTICATED" { throw ProductError.unauthenticated }; throw PasswordFailure.credentials }
                if response.statusCode == 429 { throw PasswordFailure.rateLimited }
                if response.statusCode == 400 { throw PasswordFailure.invalidInput }
                throw PasswordFailure.unavailable
            }
            // Auth endpoints need their scoped code even for 401; they never clear a store.
            guard response.statusCode == 200 else { throw SOOPAuthError.response(data, status: response.statusCode) }
            return data
        } catch let error as PasswordFailure { throw error }
        catch let error as SOOPAuthError { throw error }
        catch let error as ProductError { throw error }
        catch {
            if Task.isCancelled || error is CancellationError || (error as? URLError)?.code == .cancelled { throw CancellationError() }
            throw ProductError.connection
        }
    }
    func performM11(_ endpoint: M11Endpoint, credential: NativeCredential) async throws -> Data {
        try await performM11(endpoint, credential: credential, admission: NativeRequestAdmission(check: {}))
    }
    func performM11(_ endpoint: M11Endpoint, credential: NativeCredential, admission: NativeRequestAdmission) async throws -> Data {
        let request = try endpoint.request(environment: environment, credential: credential)
        do {
            try await admission.validate()
            try Task.checkCancellation(); try admission.check()
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
    func performAccountFeature(_ input: ConversationFeatureRequest, credential: NativeCredential, scope: RoomsScope) async throws -> Data {
        try scope.check()
        let request = try input.accountRequest(environment: environment, credential: credential)
        try scope.check(); try input.admit()
        let (bytes, response) = try await session.bytes(for: request)
        defer { bytes.task.cancel() }
        try scope.check()
        guard let response = response as? HTTPURLResponse, response.url == request.url, response.expectedContentLength <= Int64(Self.maximumBodyBytes) else { throw ProductError.invalidResponse }
        if response.statusCode == 401 { throw ProductError.unauthenticated }
        let data = try await Self.readBody(bytes, cancel: { bytes.task.cancel() }); try scope.check()
        guard response.statusCode == input.expectedStatus else { throw ConversationFeatureFailure(status: response.statusCode, data: data) }
        guard input.expectedStatus != 204 || data.isEmpty else { throw ProductError.invalidResponse }
        return data
    }
    func performConversation(_ endpoint: ConversationEndpoint, credential: NativeCredential, scope: ConversationScope) async throws -> Data {
        try scope.check()
        let request = try endpoint.request(environment: environment, credential: credential, scope: scope)
        do {
            try scope.check(); try endpoint.admit()
            let (bytes, response) = try await session.bytes(for: request)
            defer { bytes.task.cancel() }
            try scope.check()
            guard let response = response as? HTTPURLResponse, response.url == request.url else { throw ConversationError.invalidResponse }
            if response.statusCode == 401 { throw ProductError.unauthenticated }
            guard response.expectedContentLength <= Int64(Self.maximumBodyBytes) else { throw ConversationError.invalidResponse }
            let data = try await Self.readBody(bytes, cancel: { bytes.task.cancel() })
            try scope.check()
            guard response.statusCode == endpoint.expectedStatus else {
                if case .feature = endpoint { throw ConversationFeatureFailure(status: response.statusCode, data: data) }
                throw ConversationEndpoint.error(data: data, status: response.statusCode, writing: endpoint.isSending)
            }
            if endpoint.expectedStatus == 204, !data.isEmpty { throw ConversationError.invalidResponse }
            return data
        } catch let error as ConversationFeatureFailure { throw error }
        catch let error as ConversationError { throw error }
        catch let error as ProductError { throw error }
        catch let error as RoomsError { throw error }
        catch {
            if Task.isCancelled || error is CancellationError || (error as? URLError)?.code == .cancelled { throw CancellationError() }
            throw ConversationError.unavailable
        }
    }
    func performAccountDeletion(credential: NativeCredential, permit: AccountDeletionPermit) async throws -> AccountDeletionResponse {
        let request = try AccountDeletionEndpoint.request(environment: environment, credential: credential)
        try permit.claim()
        do {
            let (bytes, response) = try await session.bytes(for: request)
            defer { bytes.task.cancel() }
            guard let response = response as? HTTPURLResponse, response.url == request.url,
                  response.expectedContentLength <= Int64(AccountDeletionEndpoint.maximumBytes) else { return .unknown }
            let data = try await Self.readBody(bytes, limit: AccountDeletionEndpoint.maximumBytes, cancel: { bytes.task.cancel() })
            return AccountDeletionEndpoint.response(data, status: response.statusCode)
        } catch { return .unknown } // Socket failure/cancellation never proves non-admission.
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
