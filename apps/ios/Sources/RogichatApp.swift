import SwiftUI

@main
struct RogichatApp: App {
    private let environment = AppEnvironment()
    var body: some Scene {
        WindowGroup {
#if ROGICHAT_QA
            WireframeHost()
#else
            ProductionShell()
#endif
        }
    }
}

#if !ROGICHAT_QA
private struct ProductionShell: View {
    // No session adapter yet: production access is permanently SignedOut.
    @State private var navigation = ShellNavigation()
    var body: some View {
        AppShell(navigation: navigation, onTab: { navigation.selectTab($0) }, onPop: { navigation.pop(to: $0, in: $1) }) { page in
            switch page {
            case .settings: SettingsScreen(access: navigation.access) { navigation.open($0) }
            case .notifications: NotificationSettingsScreen()
            case .about: AboutScreen()
            default: WelcomeScreen()
            }
        }
    }
}
#endif
