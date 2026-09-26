import Foundation

// Transport boundary for the copied Meloming channel implementation. Native
// credentials stay in Rogichat's protected store; redirects/replays are rejected.
enum ChannelEnvironment {
    static var native: NativeEnvironment { NativeEnvironment(rawValue: AppEnvironment().name.rawValue)! }
    static var apiOrigin: URL { native.baseURL.deletingLastPathComponent() }
    static var webURL: URL { URL(string: native == .qa ? "https://qa.rogi.chat" : "https://rogi.chat")! }
    static func imageURL(_ value: String?) -> URL? {
        guard let value, !value.isEmpty else { return nil }
        if value.hasPrefix("/") { return webURL.appendingPathComponent(value) }
        guard let url = URL(string: value), url.scheme == "https" else { return nil }
        return url
    }
}

enum ChannelAPIError: LocalizedError {
    case invalidResponse, unauthorized, connection
    case clientError(statusCode: Int, message: String)
    var errorDescription: String? {
        switch self {
        case .unauthorized: "로그인 후 이용해 주세요."
        case .clientError(_, let message): message
        case .connection: "연결을 확인하고 다시 시도해 주세요."
        case .invalidResponse: "불러올 수 없어요. 잠시 후 다시 시도해 주세요."
        }
    }
}

@MainActor final class ChannelSession {
    static let shared = ChannelSession()
    struct User: Decodable { let id: Int; let nickname: String }
    private(set) var currentUser: User?
    var isAuthenticated: Bool { (try? ChannelAPIClient.shared.credentials.read()) != nil }
    func refresh() async {
        guard isAuthenticated else { currentUser = nil; return }
        currentUser = try? await ChannelAPIClient.shared.request(endpoint: .me, responseType: User.self)
    }
}

@MainActor final class ChannelAPIClient {
    static let shared = ChannelAPIClient()
    let credentials = NativeCredentialStore(environment: ChannelEnvironment.native)
    private let session = URLSession(configuration: NativeAPIClient.configuration(), delegate: NativeSessionDelegate(), delegateQueue: nil)
    private let maximumBytes = 4 * 1024 * 1024

    func request<Value: Decodable>(endpoint: ChannelAPIEndpoint, responseType: Value.Type) async throws -> Value {
        let data = try await perform(endpoint: endpoint)
        do { return try JSONDecoder().decode(Value.self, from: data) }
        catch { throw ChannelAPIError.invalidResponse }
    }

    func requestOptional<Value: Decodable>(endpoint: ChannelAPIEndpoint, responseType: Value.Type) async throws -> Value? {
        let data = try await perform(endpoint: endpoint)
        if data.isEmpty { return nil }
        do { return try JSONDecoder().decode(Optional<Value>.self, from: data) }
        catch { throw ChannelAPIError.invalidResponse }
    }

    func requestWithoutResponse(endpoint: ChannelAPIEndpoint) async throws {
        _ = try await perform(endpoint: endpoint)
    }

    private func perform(endpoint: ChannelAPIEndpoint) async throws -> Data {
        var components = URLComponents(url: ChannelEnvironment.apiOrigin.appendingPathComponent(endpoint.path), resolvingAgainstBaseURL: false)!
        components.queryItems = endpoint.queryItems
        var request = URLRequest(url: components.url!)
        request.httpMethod = endpoint.method.rawValue
        request.httpBody = endpoint.body
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        return try await send(request)
    }

    private func send(_ input: URLRequest) async throws -> Data {
        var request = input
        let credential = try credentials.read()
        if let credential {
            guard credential.isValid, credential.environment == ChannelEnvironment.native,
                  credential.expiresAt > Date() else { throw ChannelAPIError.unauthorized }
            request.setValue("Bearer \(credential.token)", forHTTPHeaderField: "Authorization")
            request.setValue("ios", forHTTPHeaderField: "X-Rogi-Client")
        }
        request.httpShouldHandleCookies = false
        request.cachePolicy = .reloadIgnoringLocalCacheData
        request.setValue("application/json", forHTTPHeaderField: "Accept")
        guard try credentials.read() == credential else { throw ProductError.sessionChanged }
        do {
            let (bytes, response) = try await session.bytes(for: request)
            defer { bytes.task.cancel() }
            guard let http = response as? HTTPURLResponse, http.url == request.url,
                  http.expectedContentLength <= Int64(maximumBytes) else { throw ChannelAPIError.invalidResponse }
            var data = Data()
            for try await byte in bytes {
                guard data.count < maximumBytes else { throw ChannelAPIError.invalidResponse }
                data.append(byte)
            }
            try Task.checkCancellation()
            guard try credentials.read() == credential else { throw ProductError.sessionChanged }
            guard (200..<300).contains(http.statusCode) else {
                if http.statusCode == 401 { throw ChannelAPIError.unauthorized }
                let message = http.statusCode == 403 ? "이 기능을 이용할 권한이 없어요." :
                    http.statusCode == 409 ? "이미 등록된 내용이에요." : "처리하지 못했어요. 다시 시도해 주세요."
                throw ChannelAPIError.clientError(statusCode: http.statusCode, message: message)
            }
            return data
        } catch let error as ChannelAPIError { throw error }
        catch {
            if Task.isCancelled || error is CancellationError { throw CancellationError() }
            if error is ProductError { throw error }
            throw ChannelAPIError.connection
        }
    }

    func uploadImage(imageData: Data, fileName: String, mimeType: String) async throws -> UploadImageResponse {
        guard imageData.count <= 10 * 1024 * 1024, ["image/jpeg", "image/png", "image/webp"].contains(mimeType),
              !fileName.contains("\r"), !fileName.contains("\n"), !fileName.contains("\"") else { throw ChannelAPIError.invalidResponse }
        let boundary = UUID().uuidString
        var body = Data("--\(boundary)\r\nContent-Disposition: form-data; name=\"image\"; filename=\"\(fileName)\"\r\nContent-Type: \(mimeType)\r\n\r\n".utf8)
        body.append(imageData)
        body.append(Data("\r\n--\(boundary)--\r\n".utf8))
        var request = URLRequest(url: ChannelEnvironment.native.baseURL.appendingPathComponent("upload/image"))
        request.httpMethod = "POST"
        request.setValue("multipart/form-data; boundary=\(boundary)", forHTTPHeaderField: "Content-Type")
        request.httpBody = body
        return try JSONDecoder().decode(UploadImageResponse.self, from: await send(request))
    }
}

struct UploadImageResponse: Decodable {
    let imageUrl: String
    let fileName: String
}
