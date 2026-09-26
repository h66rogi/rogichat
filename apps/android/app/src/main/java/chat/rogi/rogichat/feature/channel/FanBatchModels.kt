package chat.rogi.rogichat.feature.channel

/** 팬 일괄(batch) 선물 대상 — 웹 fan-batch-selection.ts 대응 */
data class FanBatchRecipient(
    val userId: Int,
    val nickname: String,
    val recipientCode: String,
    val profileImageUrl: String? = null,
)

/**
 * 피커 → 배치 구성 화면으로 선택 팬 목록을 전달하는 홀더.
 * AnongiftPaymentLaunchHolder 와 동일한 패턴 (nav argument 대신 in-memory 전달).
 */
object FanBatchSelectionHolder {
    var recipients: List<FanBatchRecipient> = emptyList()
}
