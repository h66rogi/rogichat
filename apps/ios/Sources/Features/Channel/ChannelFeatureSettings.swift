import Foundation

/// GET /v1/channel/{identifier}/feature-settings 응답 (public)
/// items는 15개 고정 key 세트가 order와 함께 항상 전체 반환됩니다.
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
