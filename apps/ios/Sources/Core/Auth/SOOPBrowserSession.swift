import AuthenticationServices
import UIKit

// Adapted AuthManager.loginWithGoogle's ASWebAuthenticationSession continuation
// and presentation-context implementation. Callback tokens/custom schemes are not reused.
@MainActor final class SOOPBrowserSession: NSObject, SOOPBrowsing, ASWebAuthenticationPresentationContextProviding {
    private var session: ASWebAuthenticationSession?
    private var operation: SOOPBrowserOperation?
    private var anchor: UIWindow?
    func authorize(_ url: URL, environment: NativeEnvironment, operation: UUID, expiresAt: Date, validate: @Sendable () throws -> Void) async throws -> URL {
        try validate()
        self.operation?.finish(.failure(CancellationError()))
        guard let scene = UIApplication.shared.connectedScenes.compactMap({ $0 as? UIWindowScene })
            .first(where: { $0.activationState == .foregroundActive }),
              let window = scene.windows.first(where: \.isKeyWindow) else { throw SOOPAuthError.browserUnavailable }
        anchor = window
        let pending = SOOPBrowserOperation(id: operation, expiresAt: expiresAt)
        self.operation = pending
        return try await pending.run(start: {
                let session = ASWebAuthenticationSession(url: url, callback: .https(host: environment.webHost, path: "/mobile/auth/complete")) { [weak self] url, error in
                    Task { @MainActor in
                        guard let self, self.operation === pending else { return }
                        if let error = error as? ASWebAuthenticationSessionError, error.code == .canceledLogin { pending.finish(.failure(CancellationError())) }
                        else if error != nil { pending.finish(.failure(SOOPAuthError.browserUnavailable)) }
                        else if let url { pending.finish(.success(url)) }
                        else { pending.finish(.failure(ProductError.invalidResponse)) }
                    }
                }
                self.session = session
                session.presentationContextProvider = self
                session.prefersEphemeralWebBrowserSession = false
                if !session.start() { pending.finish(.failure(SOOPAuthError.browserUnavailable)) }
        }, onFinish: { [weak self, weak pending] in
            guard let self, let pending, self.operation === pending else { return }
            self.operation = nil
            self.session?.cancel(); self.session = nil; self.anchor = nil
        })
    }
    func presentationAnchor(for session: ASWebAuthenticationSession) -> ASPresentationAnchor { anchor ?? ASPresentationAnchor() }
    func deliver(_ url: URL, operation: UUID) -> Bool {
        guard let pending = self.operation, pending.id == operation else { return false }
        return pending.finish(.success(url))
    }
    func cancel(operation: UUID) {
        guard let pending = self.operation, pending.id == operation else { return }
        pending.finish(.failure(CancellationError()))
    }
}
