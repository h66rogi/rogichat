import Foundation

// Owns one browser continuation independently of UIKit. The deadline is the
// protected transaction's original expiry, not a fresh 600 seconds at presentation.
@MainActor final class SOOPBrowserOperation {
    let id: UUID
    private let expiresAt: Date
    private let now: @Sendable () -> Date
    private let sleep: @Sendable (Duration) async throws -> Void
    private var continuation: CheckedContinuation<URL, any Error>?
    private var watchdog: Task<Void, Never>?
    private var onFinish: (() -> Void)?
    private var started = false

    init(id: UUID, expiresAt: Date, now: @escaping @Sendable () -> Date = { Date() },
         sleep: @escaping @Sendable (Duration) async throws -> Void = { try await Task.sleep(for: $0) }) {
        self.id = id; self.expiresAt = expiresAt; self.now = now; self.sleep = sleep
    }

    func run(start: () -> Void, onFinish: @escaping () -> Void) async throws -> URL {
        if Task.isCancelled { onFinish(); throw CancellationError() }
        guard !started else { throw SOOPAuthError.browserUnavailable }
        started = true
        let remaining = expiresAt.timeIntervalSince(now())
        guard remaining > 0 else { onFinish(); throw SOOPAuthError.expired }
        self.onFinish = onFinish
        return try await withTaskCancellationHandler {
            try await withCheckedThrowingContinuation { continuation in
                self.continuation = continuation
                if Task.isCancelled { finish(.failure(CancellationError())); return }
                let sleep = sleep
                watchdog = Task { [weak self] in
                    do {
                        // Continuous-clock sleep also counts time while the app is suspended.
                        try await sleep(.seconds(remaining))
                        try Task.checkCancellation()
                        self?.finish(.failure(SOOPAuthError.expired))
                    } catch { /* Completing/cancelling this operation retires its timer. */ }
                }
                start()
            }
        } onCancel: {
            Task { @MainActor [weak self] in self?.finish(.failure(CancellationError())) }
        }
    }

    @discardableResult func finish(_ result: Result<URL, any Error>) -> Bool {
        guard let continuation else { return false }
        self.continuation = nil
        watchdog?.cancel(); watchdog = nil
        let cleanup = onFinish; onFinish = nil
        cleanup?()
        // A callback queued before the timer runs still cannot outlive the proof.
        if case .success = result, now() >= expiresAt {
            continuation.resume(throwing: SOOPAuthError.expired)
        } else { continuation.resume(with: result) }
        return true
    }
}
