import SwiftUI

@main
struct RogichatApp: App {
    @AppStorage("appearance") private var appearance = AppAppearance.system.rawValue
    var body: some Scene {
        WindowGroup {
            ProductRootView()
                .preferredColorScheme(AppAppearance(rawValue: appearance)?.colorScheme)
                .tint(AppTheme.accent)
        }
    }
}
