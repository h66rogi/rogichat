import SwiftUI

// Channel shell copied from meloming-ios 18a33bb ChannelDetailView.swift.
struct ChannelDetailView: View {
    let identifier: String
    let onTalk: () -> Void
    @StateObject private var viewModel: ChannelDetailViewModel
    @State private var selectedTab: ChannelTab = .home
    @State private var songBookSearchText = ""
    @Environment(\.openURL) private var openURL

    struct ChannelResolvedTab: Identifiable, Equatable {
        let tab: ChannelTab
        let label: String
        var id: ChannelTab { tab }
        var icon: String { tab.icon }
    }

    enum ChannelTab: String, Hashable {
        case home = "홈", songBook = "노래책", schedule = "캘린더", wardrobe = "옷장"
        var icon: String {
            switch self {
            case .home: "house.fill"
            case .songBook: "music.note.list"
            case .schedule: "calendar"
            case .wardrobe: "tshirt"
            }
        }
        static let featureKeyMap: [String: ChannelTab] = [
            "home": .home, "musicbook": .songBook, "schedule": .schedule,
            "wardrobe": .wardrobe
        ]
        static var fallbackResolvedTabs: [ChannelResolvedTab] {
            [ChannelTab.home, .songBook, .schedule, .wardrobe]
                .map { ChannelResolvedTab(tab: $0, label: $0.rawValue) }
        }
        static func resolveTabs(from settings: ChannelFeatureSettingsResponse?) -> [ChannelResolvedTab] {
            guard let settings else { return fallbackResolvedTabs }
            var resolved: [ChannelResolvedTab] = []
            for item in settings.items.sorted(by: { ($0.order ?? .max) < ($1.order ?? .max) }) where item.isEnabled {
                guard let tab = featureKeyMap[item.key], !resolved.contains(where: { $0.tab == tab }) else { continue }
                resolved.append(ChannelResolvedTab(tab: tab, label: item.displayLabel ?? tab.rawValue))
            }
            return resolved
        }
    }

    init(identifier: String = "h66rogi", onTalk: @escaping () -> Void) {
        self.identifier = identifier
        self.onTalk = onTalk
        _viewModel = StateObject(wrappedValue: ChannelDetailViewModel(identifier: identifier))
    }

    private var resolvedTabs: [ChannelResolvedTab] { ChannelTab.resolveTabs(from: viewModel.featureSettings) }

    var body: some View {
        VStack(spacing: 0) {
            TopLevelTabHeader(title: viewModel.channel?.name ?? "채널") {
                if let channel = viewModel.channel {
                    ShareLink(item: channelURL(for: channel)) {
                        Image(systemName: "square.and.arrow.up").font(.title3)
                    }
                    .accessibilityLabel("채널 공유")
                }
            }
            if viewModel.isLoading && viewModel.channel == nil {
                LoadingView()
            } else if let channel = viewModel.channel {
                ScrollView {
                    LazyVStack(spacing: 0, pinnedViews: [.sectionHeaders]) {
                        ChannelProfileHero(
                            channel: channel,
                            profile: viewModel.profile,
                            favoriteCount: viewModel.favoriteCount,
                            isLive: false,
                            onVisit: {
                                let value = channel.platformUrl.flatMap { URL(string: $0) }
                                let url = value?.scheme == "https"
                                    ? value!
                                    : URL(string: "https://play.sooplive.com/h66rogi")!
                                openURL(url)
                            },
                            onCopyLink: {
                                UIPasteboard.general.string = channelURL(for: channel).absoluteString
                            },
                            onTalk: onTalk,
                            onSongbook: { selectedTab = .songBook },
                            onLive: nil
                        )

                        Section {
                            if resolvedTabs.isEmpty {
                                ContentUnavailableView("표시할 채널 메뉴가 없어요", systemImage: "rectangle.stack")
                                    .padding(.bottom, 42)
                            } else {
                                selectedSectionContent(channel: channel)
                                    .padding(.bottom, 42)
                            }
                        } header: {
                            if !resolvedTabs.isEmpty {
                                VStack(spacing: 6) {
                                    ChannelSectionRail(
                                        tabs: resolvedTabs,
                                        selectedTab: $selectedTab
                                    )

                                    if selectedTab == .songBook {
                                        SongBookSearchBar(text: $songBookSearchText)
                                            .padding(.horizontal, 20)
                                            .padding(.bottom, 8)
                                    }
                                }
                                .padding(.top, 6)
                                .padding(.bottom, 10)
                                .background(Color(.systemBackground))
                            }
                        }
                    }
                }
                .background(Color(.systemBackground))
                .refreshable { await viewModel.loadChannel() }
            } else if let error = viewModel.error {
                VStack(spacing: 16) {
                    Image(systemName: "exclamationmark.triangle")
                        .font(.largeTitle)
                        .foregroundColor(.secondary)
                    Text("채널을 불러올 수 없습니다")
                        .foregroundColor(.secondary)
                    Button("다시 시도") { Task { await viewModel.loadChannel() } }
                    Text(error.localizedDescription).font(.caption).foregroundColor(.secondary)
                }
            } else {
                VStack(spacing: 16) {
                    Image(systemName: "exclamationmark.triangle")
                        .font(.largeTitle)
                        .foregroundColor(.secondary)
                    Text("채널을 불러올 수 없습니다")
                        .foregroundColor(.secondary)
                    Button("다시 시도") { Task { await viewModel.loadChannel() } }
                }
            }
        }
        .toolbar(.hidden, for: .navigationBar)
        .accentColor(Color(hex: "#6366F1"))
        .tint(Color(hex: "#6366F1"))
        .task { await viewModel.loadChannel() }
        .onChange(of: viewModel.featureSettings) { _, _ in
            if !resolvedTabs.contains(where: { $0.tab == selectedTab }), let first = resolvedTabs.first {
                selectedTab = first.tab
            }
        }
    }

    private func channelURL(for channel: Channel) -> URL {
        let host = AppEnvironment().name.rawValue == "qa" ? "https://qa.rogi.chat" : "https://rogi.chat"
        return URL(string: host + "/channel/" + channel.webPath)!
    }

    @ViewBuilder
    private func selectedSectionContent(channel: Channel) -> some View {
        switch selectedTab {
        case .home:
            ChannelHomeSectionView(channel: channel, profile: viewModel.profile,
                                   refreshRevision: viewModel.refreshRevision) { selectedTab = $0 }
        case .songBook: SongBookView(channelId: channel.id, identifier: identifier, pinnedSearchText: $songBookSearchText)
        case .schedule: ScheduleView(channelId: channel.id)
        case .wardrobe: ChannelWardrobeView(identifier: identifier)
        }
    }
}
