#if canImport(UIKit)
import UIKit
import UserNotifications

// Adapted Meloming PushNotificationManager permission + APNs registration sequence.
// No Firebase configuration, provider token logging, or account preference mutation.
@MainActor
final class ApplePushPermission {
    func current() async -> PushPermission {
        let settings = await UNUserNotificationCenter.current().notificationSettings()
        switch settings.authorizationStatus {
        case .authorized, .provisional, .ephemeral: return .authorized
        case .denied: return .denied
        case .notDetermined: return .notDetermined
        @unknown default: return .unknown
        }
    }
    func request() async throws -> PushPermission {
        _ = try await UNUserNotificationCenter.current().requestAuthorization(options: [.alert, .badge, .sound])
        let status = await current()
        return status
    }
    func foreground() async -> PushPermission {
        let status = await current()
        return status
    }
}
#endif
