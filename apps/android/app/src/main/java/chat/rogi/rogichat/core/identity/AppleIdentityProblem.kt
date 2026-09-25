package chat.rogi.rogichat.core.identity

enum class AppleIdentityProblem(val message: String) {
    UNAVAILABLE("지금은 Apple 로그인에 연결할 수 없어요. 잠시 후 다시 시도해 주세요."),
    CONFLICT("이미 다른 로기챗 계정에 연결된 Apple 계정이에요. 기존 SOOP 계정으로 로그인한 뒤 계정 설정을 확인해 주세요."),
    SESSION_CHANGED("로그인 상태가 변경되어 계정 연결을 중단했어요."),
    RECENT_AUTH("계정을 연결하려면 다시 로그인이 필요해요. 계정 관리에서 로그아웃한 뒤 다시 로그인해 주세요."),
    TERMS("로그인 상태를 확인하지 못했어요. 다시 로그인해 주세요."),
    FAILED("Apple 로그인을 완료하지 못했어요. 다시 시작해 주세요."),
    UNKNOWN_RESULT("로그인 결과를 확인하지 못했어요. 안전하게 새로 로그인해 주세요.");

    companion object {
        fun response(status: Int, code: String?): AppleIdentityProblem = when (status to code) {
            503 to "AUTH_UNAVAILABLE" -> UNAVAILABLE
            409 to "APPLE_LINK_CONFLICT" -> CONFLICT
            401 to "LINK_SESSION_CHANGED" -> SESSION_CHANGED
            403 to "RECENT_AUTH_REQUIRED" -> RECENT_AUTH
            403 to "TERMS_REQUIRED" -> TERMS
            else -> FAILED
        }
    }
}
