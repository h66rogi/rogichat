import Foundation

public enum DonationFormatter {
    /// 재화 키 → 표시 단위 매핑. 백엔드 PLATFORM_EXCHANGE_TABLE과 일치.
    private static let unitByCurrency: [String: String] = [
        "SOOP_BALLOON": "별풍선",
        "CHZZK_CHEESE": "치즈",
        "CIME_BEAM": "빔",
    ]

    /// 후원 금액 표시 문자열 생성.
    /// - native + 알려진 currency → "{N} {단위}"  (예: "2 별풍선")
    /// - 그 외 krwSnapshot ≠ nil → "{N}원"
    /// - 아무것도 없으면 빈 문자열
    public static func format(
        nativeAmount: Int?,
        currency: String?,
        krwSnapshot: Int?
    ) -> String {
        if let native = nativeAmount,
           let currencyKey = currency,
           let unit = unitByCurrency[currencyKey] {
            return "\(numberFormatter.string(from: NSNumber(value: native)) ?? "\(native)") \(unit)"
        }
        if let krw = krwSnapshot {
            return "\(numberFormatter.string(from: NSNumber(value: krw)) ?? "\(krw)")원"
        }
        return ""
    }

    private static let numberFormatter: NumberFormatter = {
        let f = NumberFormatter()
        f.numberStyle = .decimal
        f.locale = Locale(identifier: "ko_KR")
        return f
    }()
}
