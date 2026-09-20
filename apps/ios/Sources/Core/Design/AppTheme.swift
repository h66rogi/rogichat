import SwiftUI

enum AppTheme {
    static let accent = Color.accentColor
    static let brand = Color(red: 49.0 / 255, green: 92.0 / 255, blue: 82.0 / 255)
    static let page = Color(.systemGroupedBackground)
    static let surface = Color(.secondarySystemGroupedBackground)
}

enum AppAppearance: String, CaseIterable {
    case system, light, dark
    var title: String {
        switch self {
        case .system: "기기 설정에 맞추기"
        case .light: "라이트 모드"
        case .dark: "다크 모드"
        }
    }
    var colorScheme: ColorScheme? {
        switch self {
        case .system: nil
        case .light: .light
        case .dark: .dark
        }
    }
}

struct BrandMark: View {
    var size: CGFloat = 76
    var body: some View {
        Image(systemName: "bubble.left.and.bubble.right.fill")
            .font(.system(size: size * 0.43, weight: .semibold))
            .foregroundStyle(.white)
            .frame(width: size, height: size)
            .background(AppTheme.brand.gradient, in: RoundedRectangle(cornerRadius: size * 0.27, style: .continuous))
            .accessibilityHidden(true)
    }
}
