import Foundation

// Account settings/confirmation reuse; native admission ownership is new.
struct AccountDeletionIntent: Sendable, Identifiable {
    let id: UUID
    let accountID: String
    let accountName: String
    let clientScope: UUID
    let generation: UInt64
}
enum AccountDeletionOutcome: String, Codable, Sendable {
    case preparing, unknown, acknowledged, recentAuthRequired, rejected, notSent
}
struct AccountDeletionPresentation: Sendable, Identifiable, Equatable {
    let id: UUID
    let outcome: AccountDeletionOutcome
    let requestID: String?
    let cleanupPending: Bool
    var working = false
    var accountID: String? = nil
    var message: String {
        if working { return "탈퇴 요청을 확인하고 있어요." }
        switch outcome {
        case .acknowledged: return "탈퇴 요청이 접수됐어요. 계정 이용이 차단되었으며 데이터 삭제 완료를 뜻하지 않아요."
        case .recentAuthRequired: return "최근 로그인이 필요해요. 다시 로그인한 뒤 탈퇴를 새로 확인해 주세요."
        case .notSent, .preparing: return "탈퇴를 진행하지 못했어요. 다시 시도해 주세요."
        case .unknown: return "탈퇴 요청을 확인하고 있어요. 잠시 후 다시 확인해 주세요."
        case .rejected: return "탈퇴 요청을 처리하지 못했어요."
        }
    }
}
struct AccountDeletionUpdate: Sendable {
    let presentation: AccountDeletionPresentation
    var snapshot: SessionSnapshot?
}
protocol AccountDeletionServing: Sendable {
    func admitDeletion(_ intent: AccountDeletionIntent) async throws -> AccountDeletionUpdate
    func deletionStatus(id: UUID) async throws -> AccountDeletionPresentation
    func retryDeletionCleanup(id: UUID) async throws -> AccountDeletionUpdate
}
