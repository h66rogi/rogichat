import Foundation
import SwiftUI

// Copied from meloming-ios d133fb4, Meloming/Presentation/More/ServiceItem.swift.
// Actions and entries are replaced with Rogichat destinations that exist in QA and Prod.
struct ServiceItem: Identifiable {
    let id: String
    let name: String
    let description: String
    let iconEmoji: String
    let iconBgColor: Color
    let action: ServiceAction
}

enum ServiceAction {
    case native(AppPage)
    case talks
    case external(url: URL)
}

func gridServices(homeURL: URL) -> [ServiceItem] {
    [
        ServiceItem(
            id: "home",
            name: "홈",
            description: "로기챗 웹 홈",
            iconEmoji: "🏠",
            iconBgColor: .blue,
            action: .external(url: homeURL)
        ),
        ServiceItem(
            id: "talks",
            name: "대화",
            description: "로기챗 대화방",
            iconEmoji: "💬",
            iconBgColor: .teal,
            action: .talks
        ),
        ServiceItem(
            id: "notifications",
            name: "알림 설정",
            description: "알림 권한과 계정 알림 설정",
            iconEmoji: "🔔",
            iconBgColor: .orange,
            action: .native(.notifications)
        ),
        ServiceItem(
            id: "appearance",
            name: "화면 모드",
            description: "화면 모드 선택",
            iconEmoji: "🌓",
            iconBgColor: .indigo,
            action: .native(.appearance)
        ),
    ]
}
