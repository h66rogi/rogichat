import SwiftUI

struct TopLevelTabHeader<Actions: View>: View {
    let title: String
    @ViewBuilder let actions: () -> Actions

    var body: some View {
        HStack(spacing: 18) {
            Text(title)
                .font(.system(size: 26, weight: .bold))
                .lineLimit(1)
                .frame(maxWidth: .infinity, alignment: .leading)
            actions()
        }
        .buttonStyle(.plain)
        .foregroundStyle(.primary)
        .padding(.horizontal, 22)
        .padding(.top, 18)
        .padding(.bottom, 18)
        .background(Color(uiColor: .systemBackground))
    }
}

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

    private var selection: Binding<AppTab> { Binding(get: { navigation.tab }, set: { onTab($0) }) }
    var body: some View {
        Group {
            if #available(iOS 26.0, *) {
                TabView(selection: selection) {
                    Tab("대화", systemImage: "bubble.left.and.bubble.right.fill", value: AppTab.talks) { stack(.talks) }
                    Tab("채널", systemImage: "music.note.house", value: AppTab.channel) { stack(.channel) }
                    Tab("더보기", systemImage: "ellipsis", value: AppTab.settings) { stack(.settings) }
                }
            } else {
                TabView(selection: selection) {
                    stack(.talks).tabItem { Label("대화", systemImage: "bubble.left.and.bubble.right.fill") }.tag(AppTab.talks)
                    stack(.channel).tabItem { Label("채널", systemImage: "music.note.house") }.tag(AppTab.channel)
                    stack(.settings).tabItem { Label("더보기", systemImage: "ellipsis") }.tag(AppTab.settings)
                }
            }
        }
        .tint(AppTheme.accent)
        .environment(\.foregroundEpoch, foreground.epoch)
        .onChange(of: scenePhase, initial: true) { _, phase in foreground.transition(phase == .active) }
    }
    private func stack(_ tab: AppTab) -> some View {
        NavigationStack(path: Binding(get: { navigation.path(for: tab) }, set: { onPop($0, tab) })) {
            page(navigation.root(for: tab))
                .navigationDestination(for: AppPage.self) { page($0) }
        }
        .accentColor(tab == .channel ? Color("ChannelAccentColor") : AppTheme.accent)
        .tint(tab == .channel ? Color("ChannelAccentColor") : AppTheme.accent)
    }
    @ViewBuilder private func page(_ value: AppPage) -> some View {
        if value == .channel {
            content(value)
        } else {
            content(value)
                .navigationTitle(value.rawValue)
                .navigationBarTitleDisplayMode(value == .rooms ? .large : .inline)
                .toolbar([.settings, .rooms].contains(value) ? .hidden : .visible, for: .navigationBar)
        }
    }
}
