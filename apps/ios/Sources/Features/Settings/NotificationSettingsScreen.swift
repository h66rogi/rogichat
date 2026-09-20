import SwiftUI
import UserNotifications

struct NotificationSettingsScreen: View {
    @Environment(\.scenePhase) private var scenePhase
    @State private var observing = false
    @State private var status = "아직 확인하지 않았어요"
    @State private var failure: String?
    @State private var requestRevision = 0
    @State private var refreshTrigger = 0

    var body: some View {
        VStack(alignment: .leading, spacing: 20) {
            SettingsSection(title: "이 기기의 OS 설정") {
                SettingsRow(icon: "bell", title: "알림 권한 확인", subtitle: status) {
                    observing = true
                    refreshTrigger += 1
                }
                SettingsRow(icon: "gearshape", title: "시스템 알림 설정 열기", subtitle: "기기 설정을 직접 확인해요") {
                    observing = true
                    guard let url = URL(string: UIApplication.openNotificationSettingsURLString) else { return }
                    UIApplication.shared.open(url) { opened in
                        failure = opened ? nil : "시스템 설정을 열지 못했어요. 기기 설정에서 로기챗을 찾아주세요."
                    }
                }
            }
            if let failure { Text(failure).font(.footnote) }
            SettingsSection(title: "서비스 연결") {
                SettingsRow(icon: "slider.horizontal.3", title: "알림 선호 설정", subtitle: "서버 미연동 · 저장되지 않아요", enabled: false)
                SettingsRow(icon: "iphone", title: "기기 등록", subtitle: "푸시 제공자 미연동 · 등록되지 않았어요", enabled: false)
            }
            Text("권한을 확인해도 푸시 수신이 활성화되지는 않아요. 권한 요청이나 기기 등록을 자동 실행하지 않아요.")
                .font(.footnote).foregroundStyle(.secondary)
        }
        .task(id: refreshTrigger) { if observing { await refresh() } }
        .onChange(of: scenePhase) { _, phase in
            if observing && phase == .active { refreshTrigger += 1 }
        }
    }
    @MainActor private func refresh() async {
        requestRevision += 1
        let revision = requestRevision
        let settings = await UNUserNotificationCenter.current().notificationSettings()
        guard !Task.isCancelled, revision == requestRevision else { return }
        switch settings.authorizationStatus {
        case .notDetermined: status = "이 기기에서 아직 권한을 요청하지 않았어요"
        case .denied: status = "이 기기에서 알림이 허용되지 않았어요"
        case .authorized: status = settings.alertSetting == .enabled ? "기기 알림 허용 · 알림 표시 켜짐" : "기기 알림 허용 · 알림 표시는 꺼짐"
        case .provisional: status = "조용한 알림만 임시 허용되어 있어요"
        case .ephemeral: status = "일시적으로 알림이 허용되어 있어요"
        @unknown default: status = "기기 설정에서 알림 상태를 확인해 주세요"
        }
    }
}
