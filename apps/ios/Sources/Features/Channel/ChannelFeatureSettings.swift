import Foundation

/// GET /v1/channel/{identifier}/feature-settings 응답 (public)
/// 채널에 설정된 메뉴와 순서를 반환합니다.
struct ChannelFeatureSettingItem: Decodable, Equatable {
    let key: String
    let label: String?
    let defaultLabel: String?
    let isEnabled: Bool
    let order: Int?

    var displayLabel: String? {
        if let label, !label.isEmpty { return label }
        if let defaultLabel, !defaultLabel.isEmpty { return defaultLabel }
        return nil
    }
}

struct ChannelFeatureSettingsResponse: Decodable, Equatable {
    let items: [ChannelFeatureSettingItem]
    // customItems(page|board 커스텀 메뉴)는 iOS 미지원 — 디코딩 생략(graceful 제외)
}
