#if canImport(UIKit)
import AuthenticationServices
import UIKit

enum AppleAuthorizationFailure: Error { case cancelled, unavailable, invalidCredential, superseded }

// Server transaction supplies exact nonce/state; this primitive never creates a session.
// Identity material stays in memory and is handed only to the server exchange owner.
struct AppleAuthorizationMaterial: CustomStringConvertible, CustomDebugStringConvertible {
    let identityToken: String
    let authorizationCode: String
    let state: String
    var description: String { "AppleAuthorizationMaterial([redacted])" }
    var debugDescription: String { description }
}

/// Modified reuse: Meloming AuthManager.loginWithApple + AppleSignInDelegate.
/// Keep native request/controller/delegate/credential extraction; remove legacy API,
/// user-email merging, logging, and implicit login; require nonce/state and cancellation.
@MainActor
final class AppleAuthorization: NSObject, ASAuthorizationControllerDelegate, ASAuthorizationControllerPresentationContextProviding {
    private var controller: ASAuthorizationController?
    private var continuation: CheckedContinuation<AppleAuthorizationMaterial, any Error>?
    private var anchor: ASPresentationAnchor?
    private var expectedState: String?
    private var operation: UUID?

    func authorize(nonce: String, state: String, anchor: ASPresentationAnchor) async throws -> AppleAuthorizationMaterial {
        guard !nonce.isEmpty, !state.isEmpty else { throw AppleAuthorizationFailure.unavailable }
        guard controller == nil else { throw AppleAuthorizationFailure.superseded }
        try Task.checkCancellation()
        let operation = UUID()
        self.operation = operation
        self.anchor = anchor; expectedState = state
        let appleIDProvider = ASAuthorizationAppleIDProvider()
        let request = appleIDProvider.createRequest()
        request.requestedScopes = [] // Identity uses the verified subject, never name or email.
        request.nonce = nonce
        request.state = state
        return try await withTaskCancellationHandler {
            try await withCheckedThrowingContinuation { continuation in
                self.continuation = continuation
                let controller = ASAuthorizationController(authorizationRequests: [request])
                self.controller = controller
                controller.delegate = self
                controller.presentationContextProvider = self
                controller.performRequests()
            }
        } onCancel: {
            Task { @MainActor [weak self] in
                guard self?.operation == operation else { return }
                self?.cancel()
            }
        }
    }
    func cancel() {
        let active = controller
        // Detach before native cancellation can invoke its delegate again.
        finish(.failure(AppleAuthorizationFailure.cancelled))
        active?.cancel()
    }
    func presentationAnchor(for controller: ASAuthorizationController) -> ASPresentationAnchor {
        // ASAuthorizationController asks while the operation retains its real window.
        guard let anchor else { preconditionFailure("Apple presentation requested outside active operation") }
        return anchor
    }
    func authorizationController(controller: ASAuthorizationController, didCompleteWithAuthorization authorization: ASAuthorization) {
        guard self.controller === controller else { return }
        guard let credential = authorization.credential as? ASAuthorizationAppleIDCredential,
              let identityTokenData = credential.identityToken,
              let identityToken = String(data: identityTokenData, encoding: .utf8), !identityToken.isEmpty,
              let codeData = credential.authorizationCode,
              let authorizationCode = String(data: codeData, encoding: .utf8), !authorizationCode.isEmpty,
              let state = credential.state, state == expectedState else {
            finish(.failure(AppleAuthorizationFailure.invalidCredential)); return
        }
        finish(.success(AppleAuthorizationMaterial(identityToken: identityToken, authorizationCode: authorizationCode, state: state)))
    }
    func authorizationController(controller: ASAuthorizationController, didCompleteWithError error: any Error) {
        guard self.controller === controller else { return }
        let cancelled = (error as? ASAuthorizationError)?.code == .canceled
        finish(.failure(cancelled ? AppleAuthorizationFailure.cancelled : AppleAuthorizationFailure.unavailable))
    }
    private func finish(_ result: Result<AppleAuthorizationMaterial, any Error>) {
        let pending = continuation
        continuation = nil; controller?.delegate = nil; controller?.presentationContextProvider = nil
        controller = nil; anchor = nil; expectedState = nil; operation = nil
        pending?.resume(with: result)
    }
}
#endif
#if canImport(UIKit)
@MainActor final class NativeApplePresentation: AppleAuthorizing {
    private let authorization = AppleAuthorization()
    private var operation: UUID?
    func authorize(nonce: String, state: String, operation: UUID, validate: @Sendable () throws -> Void) async throws -> AppleProviderMaterial {
        try validate()
        guard let scene = UIApplication.shared.connectedScenes.compactMap({ $0 as? UIWindowScene }).first(where: { $0.activationState == .foregroundActive }),
              let window = scene.windows.first(where: \.isKeyWindow) else { throw AppleIdentityProblem.unavailable }
        self.operation = operation
        defer { if self.operation == operation { self.operation = nil } }
        do {
            let value = try await authorization.authorize(nonce: nonce, state: state, anchor: window)
            try validate()
            return AppleProviderMaterial(code: value.authorizationCode, token: value.identityToken, state: value.state)
        } catch AppleAuthorizationFailure.cancelled { throw CancellationError() }
    }
    func cancel(operation: UUID) { guard self.operation == operation else { return }; self.operation = nil; authorization.cancel() }
}
#endif
