import UserNotifications
import UIKit

@MainActor
struct NotificationSystem {
    func read() async -> NotificationSnapshot {
        let settings = await UNUserNotificationCenter.current().notificationSettings()
        let authorization: NotificationAuthorization
        switch settings.authorizationStatus {
        case .notDetermined: authorization = .notRequested
        case .denied: authorization = .denied
        case .authorized: authorization = .allowed
        case .provisional: authorization = .quiet
        case .ephemeral: authorization = .temporary
        @unknown default: authorization = .unknown
        }
        return NotificationSnapshot(authorization: authorization, alertsEnabled: settings.alertSetting == .enabled)
    }
    func openSettings() async -> Bool {
        guard let url = URL(string: UIApplication.openNotificationSettingsURLString) else { return false }
        return await UIApplication.shared.open(url)
    }
}
