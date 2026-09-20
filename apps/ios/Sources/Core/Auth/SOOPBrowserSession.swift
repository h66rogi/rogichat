import AuthenticationServices
import UIKit

// Adapted AuthManager.loginWithGoogle's ASWebAuthenticationSession continuation
// and presentation-context implementation. Callback tokens/custom schemes are not reused.
@MainActor final class SOOPBrowserSession: NSObject, SOOPBrowsing, ASWebAuthenticationPresentationContextProviding {
    private var session: ASWebAuthenticationSession?
    private var continuation: CheckedContinuation<URL, any Error>?
    private var operation: UUID?
    private var anchor: UIWindow?
    func authorize(_ url: URL, environment: NativeEnvironment, operation: UUID, validate: @Sendable () throws -> Void) async throws -> URL {
        try validate()
        finish(.failure(CancellationError()))
        guard let scene = UIApplication.shared.connectedScenes.compactMap({ $0 as? UIWindowScene })
            .first(where: { $0.activationState == .foregroundActive }),
              let window = scene.windows.first(where: \.isKeyWindow) else { throw SOOPAuthError.browserUnavailable }
        anchor = window
        let id = operation; self.operation = id
        return try await withTaskCancellationHandler {
            try Task.checkCancellation()
            return try await withCheckedThrowingContinuation { continuation in
                self.continuation = continuation
                let session = ASWebAuthenticationSession(url: url, callback: .https(host: environment.webHost, path: "/mobile/auth/complete")) { [weak self] url, error in
                    Task { @MainActor in
                        guard let self, self.operation == id else { return }
                        if let error = error as? ASWebAuthenticationSessionError, error.code == .canceledLogin { self.finish(.failure(CancellationError())) }
                        else if error != nil { self.finish(.failure(SOOPAuthError.browserUnavailable)) }
                        else if let url { self.finish(.success(url)) }
                        else { self.finish(.failure(ProductError.invalidResponse)) }
                    }
                }
                self.session = session
                session.presentationContextProvider = self
                session.prefersEphemeralWebBrowserSession = false
                if !session.start() { finish(.failure(SOOPAuthError.browserUnavailable)) }
            }
        } onCancel: { Task { @MainActor [weak self] in if self?.operation == id { self?.cancel(operation: id) } } }
    }
    func presentationAnchor(for session: ASWebAuthenticationSession) -> ASPresentationAnchor { anchor ?? ASPresentationAnchor() }
    func deliver(_ url: URL, operation: UUID) -> Bool {
        guard self.operation == operation, continuation != nil else { return false }
        finish(.success(url)); return true
    }
    func cancel(operation: UUID) {
        guard self.operation == operation else { return }
        finish(.failure(CancellationError()))
    }
    private func finish(_ result: Result<URL, any Error>) {
        let continuation = continuation
        self.continuation = nil; operation = nil
        session?.cancel(); session = nil; anchor = nil
        continuation?.resume(with: result)
    }
}
