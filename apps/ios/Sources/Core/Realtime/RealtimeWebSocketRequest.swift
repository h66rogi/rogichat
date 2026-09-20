import Foundation

enum RealtimeWebSocketRequest {
    static func make(origin: URL, headers: [String: String]) throws -> URLRequest {
        guard ["https://api.qa.rogi.chat", "https://api.rogi.chat"].contains(origin.absoluteString),
              Set(headers.keys) == ["Authorization", "X-Rogi-Client"], headers["X-Rogi-Client"] == "ios",
              let authorization = headers["Authorization"], authorization.utf8.count == 50,
              authorization.range(of: "^Bearer [A-Za-z0-9_-]{43}$", options: .regularExpression) != nil else { throw RealtimeContractError.invalid }
        var components = URLComponents(url: origin, resolvingAgainstBaseURL: false)!
        components.scheme = "wss"; components.path = "/v1/realtime/"
        components.queryItems = [URLQueryItem(name: "EIO", value: "4"), URLQueryItem(name: "transport", value: "websocket")]
        var request = URLRequest(url: components.url!)
        request.httpShouldHandleCookies = false
        request.cachePolicy = .reloadIgnoringLocalCacheData
        request.timeoutInterval = 5
        request.allHTTPHeaderFields = headers
        return request
    }
    static func configuration() -> URLSessionConfiguration {
        let config = URLSessionConfiguration.ephemeral
        config.httpCookieStorage = nil; config.httpShouldSetCookies = false
        config.urlCredentialStorage = nil; config.urlCache = nil
        config.requestCachePolicy = .reloadIgnoringLocalCacheData
        return config
    }
}

final class RealtimeRejectRedirects: NSObject, URLSessionTaskDelegate, @unchecked Sendable {
    func urlSession(_ session: URLSession, task: URLSessionTask, willPerformHTTPRedirection response: HTTPURLResponse,
                    newRequest request: URLRequest, completionHandler: @escaping @Sendable (URLRequest?) -> Void) {
        completionHandler(nil)
    }
}
