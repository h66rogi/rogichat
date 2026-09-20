import SwiftUI

// Reduced TabView + per-tab NavigationStack composition; provenance R07.
struct AppShell<Content: View>: View {
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
