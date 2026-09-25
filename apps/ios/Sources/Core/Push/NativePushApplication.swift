#if canImport(UIKit)
import UIKit
import UserNotifications
import SwiftUI

// One native registration at a time. Cancelling a UI caller does not repurpose
// an outstanding APNs callback for another account's request.
@MainActor final class APNsDeviceRegistration {
    static let shared = APNsDeviceRegistration()
    private var pending: (UUID, CheckedContinuation<DevicePushToken, any Error>)?
    private var waitingForNativeCallback = false
    func request() async throws -> DevicePushToken {
        guard pending == nil, !waitingForNativeCallback else { throw ProductError.unavailable }
        try Task.checkCancellation()
        let operation = UUID()
        let token: DevicePushToken = try await withCheckedThrowingContinuation { continuation in
            pending = (operation, continuation); waitingForNativeCallback = true
            UIApplication.shared.registerForRemoteNotifications()
            Task { [weak self] in
                try? await Task.sleep(for: .seconds(30))
                guard self?.pending?.0 == operation else { return }
                // Native callbacks have no request ID. Keep the outstanding reservation
                // after this observer times out; a late callback must not fulfill a new one.
                self?.finish(.failure(ProductError.connection))
            }
        }
        try Task.checkCancellation(); return token
    }
    func received(_ data: Data) {
        guard waitingForNativeCallback else { return }; waitingForNativeCallback = false
        do { finish(.success(try NativePushContract.apnsToken(data))) } catch { finish(.failure(error)) }
    }
    func failed() {
        guard waitingForNativeCallback else { return }; waitingForNativeCallback = false
        finish(.failure(ProductError.connection))
    }
    private func finish(_ result: Result<DevicePushToken, any Error>) { let old = pending; pending = nil; old?.1.resume(with: result) }
}
@MainActor final class NativePushWakeOwner {
    static let shared = NativePushWakeOwner()
    var wake: (() async -> Bool)?
}
@MainActor final class RogichatApplicationDelegate: NSObject, UIApplicationDelegate {
    func application(_ application: UIApplication, didRegisterForRemoteNotificationsWithDeviceToken deviceToken: Data) {
        APNsDeviceRegistration.shared.received(deviceToken)
    }
    func application(_ application: UIApplication, didFailToRegisterForRemoteNotificationsWithError error: any Error) {
        APNsDeviceRegistration.shared.failed()
    }
    func application(_ application: UIApplication, didReceiveRemoteNotification userInfo: [AnyHashable: Any], fetchCompletionHandler completionHandler: @escaping (UIBackgroundFetchResult) -> Void) {
        guard NativePushWake.accepts(userInfo), let wake = NativePushWakeOwner.shared.wake else { completionHandler(.noData); return }
        Task { completionHandler(await wake() ? .newData : .noData) }
    }
}

struct NativePushSection: View {
    let scope: UInt64
    let session: AppSession
    let onChanged: () -> Void
    @State private var busy = false
    @State private var message: String?
    @State private var available: Bool?
    @State private var permission = PushPermission.unknown
    private let system = ApplePushPermission()
    var body: some View {
        Section {
            if busy { ProgressView("알림 설정 확인 중") }
            if available == false { Text("이 기기에서는 알림을 켤 수 없어요.").foregroundStyle(.secondary) }
            Button("이 기기에서 알림 받기") { Task { await enable() } }.disabled(busy || available == false)
            if let message { Text(message).font(.footnote).foregroundStyle(.secondary) }
        } header: { Text("알림") }
          footer: { Text("알림을 허용하면 이 기기에서 새 메시지를 받을 수 있어요.") }
          .task {
              permission = await system.current()
              do { available = try await session.pushCapabilities(scope: scope).available }
              catch { message = (error as? LocalizedError)?.errorDescription ?? "알림 등록 가능 여부를 확인하지 못했어요." }
          }
    }
    private func enable() async {
        guard !busy else { return }
        busy = true; message = nil; defer { busy = false }
        do {
            available = try await session.pushCapabilities(scope: scope).available
            guard available == true else { throw ProductError.unavailable }
            // Permission belongs to this explicit choice, never app startup or a GET callback.
            permission = await system.current()
            if permission == .notDetermined { permission = try await system.request() }
            guard permission == .authorized else { message = "iPhone 설정에서 로기챗 알림을 허용해 주세요."; return }
            guard session.generation == scope, session.access == .ready else { throw ProductError.sessionChanged }
            let token = try await APNsDeviceRegistration.shared.request()
            _ = try await session.enablePush(token: token, scope: scope, permission: { await system.current() })
            guard session.generation == scope else { throw ProductError.sessionChanged }
            message = "기기 등록과 계정 알림 켜기가 확인되었어요."; onChanged()
        } catch {
            guard session.generation == scope else { return }
            message = (error as? LocalizedError)?.errorDescription ?? "결과를 확인하지 못했어요. 현재 상태를 확인한 뒤 다시 선택해 주세요."
            onChanged() // GET only, never an automatic registration/preference write.
        }
    }
}
#endif
