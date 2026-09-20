import SwiftUI

@main
struct RogichatApp: App {
    private let environment = AppEnvironment()

    var body: some Scene {
        WindowGroup {
#if ROGICHAT_QA
            WireframeHost()
#else
            NavigationStack {
                ScrollView {
                    WelcomeScreen().padding(20)
                }
                .navigationTitle(environment.displayName)
            }
#endif
        }
    }
}
