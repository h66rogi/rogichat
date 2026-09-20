import Foundation
import Observation

// Adapted NotificationSettingsViewModel's main-actor loading/request/error flow.
// Confirmed server values and explicit commands replace default-true and rollback
// onChange: loading or reconciliation must never dispatch a PUT.
@MainActor @Observable
final class AccountNotificationModel {
    private(set) var confirmed: AccountNotificationPreferences?
    private(set) var loading = false
    private(set) var saving = false
    private(set) var fresh = false
    private(set) var errorMessage: String?
    private var revision: UInt64 = 0
    private let fetch: () async throws -> AccountNotificationPreferences
    private let disable: (PreferenceGeneration) async throws -> AccountNotificationPreferences
    init(fetch: @escaping () async throws -> AccountNotificationPreferences,
         disable: @escaping (PreferenceGeneration) async throws -> AccountNotificationPreferences) {
        self.fetch = fetch; self.disable = disable
    }
    var canDisable: Bool { fresh && confirmed?.pushEnabled == true && !loading && !saving }
    func load() async { await refresh(notice: nil) }
    private func refresh(notice: String?) async {
        guard !saving else { return }
        revision &+= 1; let ticket = revision
        loading = true; fresh = false; errorMessage = notice
        defer { if ticket == revision { loading = false } }
        do {
            let value = try await fetch()
            guard ticket == revision, !Task.isCancelled else { return }
            confirmed = value; fresh = true
        } catch {
            guard ticket == revision, !Task.isCancelled else { return }
            errorMessage = (error as? LocalizedError)?.errorDescription ?? ProductError.connection.errorDescription
        }
    }
    func disableForAccount() async {
        guard canDisable, let expected = confirmed?.generation else { return }
        revision &+= 1; let ticket = revision
        saving = true; fresh = false; errorMessage = nil
        defer { if ticket == revision { saving = false } }
        do {
            let value = try await disable(expected)
            guard ticket == revision, !Task.isCancelled else { return }
            guard !value.pushEnabled else { throw ProductError.invalidResponse }
            confirmed = value; fresh = true
        } catch {
            guard ticket == revision, !Task.isCancelled else { return }
            saving = false
            if error as? M11Error == .conflict {
                await refresh(notice: "다른 곳에서 설정이 변경되었어요. 현재 상태를 확인한 뒤 변경하려면 다시 선택해 주세요.")
            } else if error as? ProductError == .connection || error as? ProductError == .invalidResponse {
                await refresh(notice: "변경 결과를 확인하지 못했어요. 현재 상태를 확인한 뒤 변경하려면 다시 선택해 주세요.")
            } else {
                errorMessage = (error as? LocalizedError)?.errorDescription ?? ProductError.connection.errorDescription
            }
        }
    }
    func cancel() {
        revision &+= 1; confirmed = nil; fresh = false; loading = false; saving = false; errorMessage = nil
    }
}
