import Foundation

enum AppleIdentityProblem: Error, LocalizedError, Sendable {
    case unavailable, conflict, sessionChanged, recentAuth, terms, failed, unknownResult
    var errorDescription: String? {
        switch self {
        case .unavailable: "지금은 Apple 로그인에 연결할 수 없어요. 잠시 후 다시 시도해 주세요."
        case .conflict: "이미 다른 로기챗 계정에 연결된 Apple 계정이에요. 기존 SOOP 계정으로 로그인한 뒤 계정 설정을 확인해 주세요."
        case .sessionChanged: "로그인 상태가 변경되어 계정 연결을 중단했어요."
        case .recentAuth: "계정을 연결하려면 다시 로그인이 필요해요. 계정 관리에서 로그아웃한 뒤 다시 로그인해 주세요."
        case .terms: "로그인 상태를 확인하지 못했어요. 다시 로그인해 주세요."
        case .failed: "Apple 로그인을 완료하지 못했어요. 다시 시작해 주세요."
        case .unknownResult: "로그인 결과를 확인하지 못했어요. 안전하게 새로 로그인해 주세요."
        }
    }
    static func response(status: Int, code: String?) -> AppleIdentityProblem {
        switch (status, code) {
        case (503, "AUTH_UNAVAILABLE"): .unavailable
        case (409, "APPLE_LINK_CONFLICT"): .conflict
        case (401, "LINK_SESSION_CHANGED"): .sessionChanged
        case (403, "RECENT_AUTH_REQUIRED"): .recentAuth
        case (403, "TERMS_REQUIRED"): .terms
        default: .failed
        }
    }
}
