import SwiftUI

// Reuses NotificationSettingsView's account Section/header/footer and async model
// composition. The native contract permits explicit account-wide disable only.
struct AccountNotificationSection: View {
    @State private var model: AccountNotificationModel
    init(fetch: @escaping () async throws -> AccountNotificationPreferences,
         disable: @escaping (PreferenceGeneration) async throws -> AccountNotificationPreferences) {
        _model = State(initialValue: AccountNotificationModel(fetch: fetch, disable: disable))
    }
    var body: some View {
        Section {
            HStack {
                Text("계정 푸시 알림")
                Spacer()
                if model.loading { ProgressView().accessibilityLabel("계정 알림 설정 확인 중") }
                else if model.saving { ProgressView().accessibilityLabel("계정 알림 끄는 중") }
                else if let value = model.confirmed {
                    Text((model.fresh ? "" : "마지막 확인: ") + (value.pushEnabled ? "켜짐" : "꺼짐"))
                        .foregroundStyle(.secondary)
                } else { Text("확인되지 않음").foregroundStyle(.secondary) }
            }
            if model.canDisable {
                Button("계정 전체 알림 끄기") { Task { await model.disableForAccount() } }
            }
            if let message = model.errorMessage {
                Text(message).font(.footnote).foregroundStyle(.secondary)
                    .accessibilityLabel("계정 알림 설정 안내. \(message)")
            }
            if !model.fresh && !model.loading && !model.saving {
                Button("계정 알림 설정 다시 확인") { Task { await model.load() } }
            }
        } header: {
            Text("계정 알림")
        } footer: {
            Text("이 계정으로 이용하는 모든 기기와 웹에 적용돼요. 이 iPhone의 알림 허용 여부와는 별도 설정이에요.")
        }
        .task { await model.load() }
        .onDisappear { model.cancel() }
    }
}
