import SwiftUI

private struct ForegroundEpochKey: EnvironmentKey { static let defaultValue: UInt64 = 0 }
extension EnvironmentValues {
    var foregroundEpoch: UInt64 {
        get { self[ForegroundEpochKey.self] }
        set { self[ForegroundEpochKey.self] = newValue }
    }
}

// Adapted MainTabView modern/legacy composition; the guarded route state is Rogichat-specific.
// Product screens own their scrolling container, including native Form/List behavior.
struct AppShell<Content: View>: View {
    @Environment(\.scenePhase) private var scenePhase
    @State private var foreground = ForegroundState()
    let navigation: ShellNavigation
    let onTab: (AppTab) -> Void
    let onPop: ([AppPage], AppTab) -> Void
    @ViewBuilder let content: (AppPage) -> Content

    var body: some View {
        VStack(spacing: 0) {
            stack(navigation.tab)
                .frame(maxWidth: .infinity, maxHeight: .infinity)
            if navigation.path(for: navigation.tab).isEmpty {
                footer
            }
        }
        .tint(AppTheme.accent)
        .environment(\.foregroundEpoch, foreground.epoch)
        .onChange(of: scenePhase, initial: true) { _, phase in foreground.transition(phase == .active) }
    }
    private var footer: some View {
        HStack(spacing: 0) {
            tabButton(.talks, symbol: "bubble.left.and.bubble.right.fill", label: "채팅")
            tabButton(.settings, symbol: "ellipsis", label: "더보기")
        }
        .padding(.top, 11).padding(.bottom, 7)
        .background(Color(uiColor: .systemBackground))
        .overlay(alignment: .top) { Divider() }
    }
    private func tabButton(_ tab: AppTab, symbol: String, label: String) -> some View {
        Button { onTab(tab) } label: {
            Image(systemName: symbol)
                .font(.system(size: 25, weight: .medium))
                .foregroundStyle(navigation.tab == tab ? .primary : .secondary)
                .frame(maxWidth: .infinity, minHeight: 42)
                .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .accessibilityLabel(label)
        .accessibilityAddTraits(navigation.tab == tab ? .isSelected : [])
    }
    private func stack(_ tab: AppTab) -> some View {
        NavigationStack(path: Binding(get: { navigation.path(for: tab) }, set: { onPop($0, tab) })) {
            page(navigation.root(for: tab))
                .navigationDestination(for: AppPage.self) { page($0) }
        }
    }
    private func page(_ value: AppPage) -> some View {
        content(value)
            .navigationTitle(value.rawValue)
            .navigationBarTitleDisplayMode([.settings, .rooms].contains(value) ? .large : .inline)
    }
}
