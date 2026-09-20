import SwiftUI

private struct ForegroundEpochKey: EnvironmentKey { static let defaultValue: UInt64 = 0 }
extension EnvironmentValues {
    var foregroundEpoch: UInt64 {
        get { self[ForegroundEpochKey.self] }
        set { self[ForegroundEpochKey.self] = newValue }
    }
}

// Reduced TabView + per-tab NavigationStack composition; provenance R07.
struct AppShell<Content: View>: View {
    @Environment(\.scenePhase) private var scenePhase
    @State private var foreground = ForegroundState()
    let navigation: ShellNavigation
    let onTab: (AppTab) -> Void
    let onPop: ([AppPage], AppTab) -> Void
    @ViewBuilder let content: (AppPage) -> Content

    var body: some View {
        TabView(selection: Binding(get: { navigation.tab }, set: onTab)) {
            ForEach(AppTab.allCases, id: \.self) { tab in
                NavigationStack(path: Binding(get: { navigation.path(for: tab) }, set: { onPop($0, tab) })) {
                    page(navigation.root(for: tab))
                        .navigationDestination(for: AppPage.self) { page($0) }
                }
                .tabItem { Label(tab.rawValue, systemImage: tab == .talks ? "bubble.left.and.bubble.right" : "gearshape") }
                .tag(tab)
            }
        }.tint(.primary)
        .environment(\.foregroundEpoch, foreground.epoch)
        .onChange(of: scenePhase, initial: true) { _, phase in foreground.transition(phase == .active) }
    }
    private func page(_ value: AppPage) -> some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 20) { content(value) }
                .frame(maxWidth: .infinity, alignment: .leading).padding(20)
        }
        .background(Color(.systemGroupedBackground))
        .scrollDismissesKeyboard(.interactively)
        .navigationTitle(value.rawValue).navigationBarTitleDisplayMode(.inline)
    }
}
