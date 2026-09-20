import SwiftUI

@main
struct RogichatApp: App {
    @UIApplicationDelegateAdaptor(RogichatApplicationDelegate.self) private var appDelegate
    @AppStorage("appearance") private var appearance = AppAppearance.system.rawValue
    init() { try? MediaScratchLifecycle.shared.prepare() }
    var body: some Scene {
        WindowGroup {
            ProductRootView()
                .preferredColorScheme(AppAppearance(rawValue: appearance)?.colorScheme)
                .tint(AppTheme.accent)
        }
    }
}
