package chat.rogi.rogichat.channelport.core.common

import java.text.NumberFormat
import java.util.Locale

object DonationFormatter {
    private val UNIT_BY_CURRENCY = mapOf(
        "SOOP_BALLOON" to "별풍선",
        "CHZZK_CHEESE" to "치즈",
        "CIME_BEAM" to "빔",
    )

    private val numberFormat: NumberFormat = NumberFormat.getNumberInstance(Locale.KOREA)

    /**
     * 후원 금액 표시 문자열 생성.
     * - native + 알려진 currency → "{N} {단위}"  예: "2 별풍선"
     * - krwSnapshot != null → "{N}원"
     * - 그 외 → 빈 문자열
     */
    fun format(
        nativeAmount: Int?,
        currency: String?,
        krwSnapshot: Int?,
    ): String {
        val unit = currency?.let { UNIT_BY_CURRENCY[it] }
        if (nativeAmount != null && unit != null) {
            return "${numberFormat.format(nativeAmount)} $unit"
        }
        if (krwSnapshot != null) {
            return "${numberFormat.format(krwSnapshot)}원"
        }
        return ""
    }
}
