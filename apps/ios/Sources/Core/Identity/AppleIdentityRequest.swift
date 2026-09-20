import Foundation

// Network/session files stay owned by the OS writer. This is its closed request seam.
extension AppleIdentityEndpoint {
    func request(environment: NativeEnvironment, intent: IdentityIntent, originalCredential: NativeCredential?) throws -> URLRequest {
        guard intent == .login ? originalCredential == nil : originalCredential != nil else { throw AppleIdentityError.invalidRequest }
        if case .start(let input) = self {
            guard input.intent == (intent == .login ? "login" : "link") else { throw AppleIdentityError.invalidRequest }
        }
        if let credential = originalCredential {
            guard credential.isValid, credential.environment == environment else { throw AppleIdentityError.invalidRequest }
        }
        var request = URLRequest(url: environment.baseURL.appendingPathComponent(path))
        request.httpMethod = "POST"; request.httpBody = try body()
        request.cachePolicy = .reloadIgnoringLocalCacheData; request.httpShouldHandleCookies = false
        request.setValue("ios", forHTTPHeaderField: "X-Rogi-Client")
        request.setValue("application/json", forHTTPHeaderField: "Accept")
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        if let credential = originalCredential { request.setValue("Bearer \(credential.token)", forHTTPHeaderField: "Authorization") }
        return request
    }
}
protocol AppleIdentityRequesting: Sendable {
    // No automatic retry of complete/exchange; unknown results require reauthentication.
    func performApple(_ endpoint: AppleIdentityEndpoint, intent: IdentityIntent, originalCredential: NativeCredential?) async throws -> Data
}
