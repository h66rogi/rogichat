import SwiftUI
import UserNotifications

// Copied and adapted from meloming-ios d133fb4,
// Meloming/Presentation/More/DeveloperToolsView.swift.
struct DeveloperToolsView: View {
    let environment: NativeEnvironment
    let session: AppSession?
    @State private var pushStatusText = "확인 중"
    @State private var adminCapabilities: AccessCapabilities.Admin?
    @State private var adminError: String?
    @State private var adminRetry = 0

    var body: some View {
        List {
            Section("현재 설정") {
                HStack {
                    Text("환경")
                    Spacer()
                    Text(environment == .qa ? "QA" : "운영")
                        .foregroundColor(.secondary)
                }

                VStack(alignment: .leading, spacing: 4) {
                    Text("API URL")
                    Text(environment.baseURL.absoluteString)
                        .font(.caption)
                        .foregroundColor(.secondary)
                }

                VStack(alignment: .leading, spacing: 4) {
                    Text("Web URL")
                    Text("https://\(environment.webHost)")
                        .font(.caption)
                        .foregroundColor(.secondary)
                }
            }

            Section("푸시 알림") {
                HStack {
                    Text("권한 상태")
                    Spacer()
                    Text(pushStatusText)
                        .foregroundColor(.secondary)
                }
            }

            if adminCapabilities?.enabled == true && adminCapabilities?.manageTestAccess == true, let session {
                Section("관리자") {
                    RoomTestAccess(session: session)
                }
            } else if let adminError {
                Section("관리자") {
                    Text(adminError).font(.footnote).foregroundStyle(.secondary)
                    Button("다시 확인") { adminRetry += 1 }
                }
            }
        }
        .navigationTitle("개발자 도구")
        .navigationBarTitleDisplayMode(.inline)
        .task { await loadPushStatus() }
        .task(id: adminRetry) { await loadAdminCapabilities() }
    }

    private func loadPushStatus() async {
        let settings = await UNUserNotificationCenter.current().notificationSettings()
        switch settings.authorizationStatus {
        case .authorized: pushStatusText = "허용됨"
        case .denied: pushStatusText = "거부됨"
        case .notDetermined: pushStatusText = "미결정"
        case .provisional: pushStatusText = "임시 허용"
        case .ephemeral: pushStatusText = "임시"
        @unknown default: pushStatusText = "알 수 없음"
        }
    }

    private func loadAdminCapabilities() async {
        adminCapabilities = nil
        adminError = nil
        guard let session, session.account != nil else { return }
        let generation = session.generation
        do {
            let data = try await session.accessRequest(.me, expected: generation)
            try Task.checkCancellation()
            guard session.generation == generation else { return }
            adminCapabilities = try JSONDecoder().decode(AccessCapabilities.self, from: data).admin
        } catch {
            if !Task.isCancelled && session.generation == generation {
                adminError = "관리자 권한을 확인하지 못했어요."
            }
        }
    }
}
