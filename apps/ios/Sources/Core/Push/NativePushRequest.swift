import Foundation

enum NativePushEndpoint: Sendable {
    case capabilities
    case register(NativePushInstallation, DevicePushToken, NativePushGeneration?)
    case resolve(NativePushInstallation)
    case remove(id: String, installation: NativePushInstallation, generation: NativePushGeneration)
    func request(environment: NativeEnvironment, credential: NativeCredential) throws -> URLRequest {
        guard credential.isValid, credential.environment == environment else { throw NativePushContractError.invalid }
        let path: String, method: String, body: Data?
        switch self {
        case .capabilities:
            path = "me/native-push-capabilities"; method = "GET"; body = nil
        case .register(let installation, let token, let generation):
            path = "me/native-push-subscriptions"; method = "POST"
            body = try NativePushContract.register(installation: installation, token: token, generation: generation)
        case .resolve(let installation):
            path = "me/native-push-subscriptions/resolve"; method = "POST"
            body = try NativePushContract.resolve(installation: installation)
        case .remove(let id, let installation, let generation):
            guard NativePushContract.uuid(id) else { throw NativePushContractError.invalid }
            path = "me/native-push-subscriptions/\(id)"; method = "DELETE"
            body = try NativePushContract.remove(installation: installation, generation: generation)
        }
        var request = URLRequest(url: environment.baseURL.appendingPathComponent(path))
        request.httpMethod = method; request.httpBody = body
        request.cachePolicy = .reloadIgnoringLocalCacheData; request.httpShouldHandleCookies = false
        request.setValue("Bearer \(credential.token)", forHTTPHeaderField: "Authorization")
        request.setValue("ios", forHTTPHeaderField: "X-Rogi-Client")
        request.setValue("application/json", forHTTPHeaderField: "Accept")
        if body != nil { request.setValue("application/json", forHTTPHeaderField: "Content-Type") }
        return request
    }
}
protocol NativePushRequesting: Sendable {
    // Must validate HTTP status: register 201, resolve/capabilities 200, delete empty 204.
    // 409/unknown results require resolve + a new scoped intent, never guessed generation.
    func performNativePush(_ endpoint: NativePushEndpoint, credential: NativeCredential) async throws -> Data
    func performNativePush(_ endpoint: NativePushEndpoint, credential: NativeCredential, admission: NativeRequestAdmission) async throws -> Data
}
extension NativePushRequesting {
    func performNativePush(_ endpoint: NativePushEndpoint, credential: NativeCredential, admission: NativeRequestAdmission) async throws -> Data {
        try await admission.validate(); return try await performNativePush(endpoint, credential: credential)
    }
}
