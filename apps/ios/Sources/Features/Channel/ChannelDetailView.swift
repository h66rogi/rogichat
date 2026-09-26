import SwiftUI

// Adapted from meloming-ios 18a33bb ChannelDetailView.swift. The profile hero,
// pinned section rail, feature-settings resolution and tab composition remain native.
struct ChannelDetailView: View {
    let identifier: String
    let onTalk: () -> Void
    @StateObject private var viewModel: ChannelDetailViewModel
    @State private var selectedTab: ChannelTab = .home

    struct ChannelResolvedTab: Identifiable, Equatable {
        let tab: ChannelTab
        let label: String
        var id: ChannelTab { tab }
        var icon: String { tab.icon }
    }

    enum ChannelTab: String, Hashable {
        case home = "홈", songBook = "노래책", schedule = "캘린더", setlist = "셋리스트", wardrobe = "옷장"
        var icon: String {
            switch self {
            case .home: "house.fill"
            case .songBook: "music.note.list"
            case .schedule: "calendar"
            case .setlist: "list.number"
            case .wardrobe: "tshirt"
            }
        }
        static let featureKeyMap: [String: ChannelTab] = [
            "musicbook": .songBook, "schedule": .schedule,
            "setlist": .setlist, "wardrobe": .wardrobe
        ]
        static var fallbackResolvedTabs: [ChannelResolvedTab] {
            [ChannelTab.home, .songBook, .schedule, .setlist, .wardrobe]
                .map { ChannelResolvedTab(tab: $0, label: $0.rawValue) }
        }
        static func resolveTabs(from settings: ChannelFeatureSettingsResponse?) -> [ChannelResolvedTab] {
            guard let settings else { return fallbackResolvedTabs }
            var resolved: [ChannelResolvedTab] = [ChannelResolvedTab(tab: .home, label: ChannelTab.home.rawValue)]
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
        Group {
            if viewModel.isLoading && viewModel.channel == nil {
                ProgressView("채널을 불러오는 중")
                    .frame(maxWidth: .infinity, maxHeight: .infinity)
            } else if let channel = viewModel.channel {
                ScrollView {
                    LazyVStack(spacing: 0, pinnedViews: [.sectionHeaders]) {
                        ChannelProfileHero(channel: channel, profile: viewModel.profile,
                                           favoriteCount: viewModel.favoriteCount, onTalk: onTalk)
                        Section {
                            if resolvedTabs.isEmpty {
                                ContentUnavailableView("표시할 채널 메뉴가 없어요", systemImage: "rectangle.stack")
                                    .padding(.top, 36)
                            } else {
                                selectedSectionContent(channel: channel)
                                    .padding(.bottom, 36)
                            }
                        } header: {
                            if !resolvedTabs.isEmpty {
                                ChannelSectionRail(tabs: resolvedTabs, selectedTab: $selectedTab)
                                    .background(.regularMaterial)
                            }
                        }
                    }
                }
                .refreshable { await viewModel.loadChannel() }
            } else {
                ContentUnavailableView("채널을 불러올 수 없어요", systemImage: "exclamationmark.triangle",
                                       description: Text("잠시 후 다시 시도해 주세요."))
                    .safeAreaInset(edge: .bottom) {
                        Button("다시 시도") { Task { await viewModel.loadChannel() } }
                            .buttonStyle(.bordered).padding()
                    }
            }
        }
        .accentColor(Color(hex: "#6366F1"))
        .tint(Color(hex: "#6366F1"))
        .navigationTitle(viewModel.channel?.name ?? "채널")
        .task { await viewModel.loadChannel() }
        .onChange(of: viewModel.featureSettings) { _, _ in
            if !resolvedTabs.contains(where: { $0.tab == selectedTab }), let first = resolvedTabs.first {
                selectedTab = first.tab
            }
        }
    }

    @ViewBuilder
    private func selectedSectionContent(channel: Channel) -> some View {
        switch selectedTab {
        case .home:
            ChannelHomeSectionView(channel: channel, profile: viewModel.profile,
                                   refreshRevision: viewModel.refreshRevision) { selectedTab = $0 }
        case .songBook: SongBookView(channelId: channel.id, identifier: identifier)
        case .schedule: ScheduleView(channelId: channel.id)
        case .setlist: ChannelSetlistView()
        case .wardrobe: ChannelWardrobeView(identifier: identifier)
        }
    }
}

private struct ChannelSetlistView: View {
    @State private var setlists: [ChannelSetlistSummary] = []
    @State private var selected: ChannelSetlistSummary?
    @State private var loading = true
    @State private var error: String?
    private let repository: ChannelRepository = AppClientChannelRepository()

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            if loading && setlists.isEmpty { ProgressView().frame(maxWidth: .infinity).padding(.top, 42) }
            else if let error, setlists.isEmpty {
                ContentUnavailableView("셋리스트를 불러올 수 없어요", systemImage: "list.number", description: Text(error))
                Button("다시 시도") { Task { await load() } }.buttonStyle(.bordered)
            } else if setlists.isEmpty { ContentUnavailableView("공개된 셋리스트가 없어요", systemImage: "list.number") }
            else {
                ForEach(setlists) { setlist in
                    Button { selected = setlist } label: {
                        HStack {
                            Image(systemName: "music.note.list").font(.title3)
                            VStack(alignment: .leading) {
                                Text(setlist.startedAt.prefix(10)).font(.headline)
                                Text("\(setlist.completedCount)곡").font(.caption).foregroundStyle(.secondary)
                            }
                            Spacer()
                            Image(systemName: "chevron.right").font(.caption)
                        }.padding(.vertical, 10)
                    }.buttonStyle(.plain)
                    Divider()
                }.padding(.horizontal, 20)
            }
        }
        .task { await load() }
        .sheet(item: $selected) { summary in ChannelSetlistDetailView(summary: summary) }
    }
    private func load() async {
        loading = true; error = nil
        do { setlists = try await repository.fetchSetlists(page: 1).setlists }
        catch { self.error = "잠시 후 다시 시도해 주세요." }
        loading = false
    }
}

private struct ChannelSetlistDetailView: View {
    let summary: ChannelSetlistSummary
    @State private var detail: ChannelSetlistDetail?
    @State private var error: String?
    private let repository: ChannelRepository = AppClientChannelRepository()

    var body: some View {
        NavigationStack {
            Group {
                if let detail {
                    List(detail.songs) { song in
                        VStack(alignment: .leading, spacing: 3) {
                            Text(song.title)
                            Text(song.artist).font(.caption).foregroundStyle(.secondary)
                        }
                    }
                } else if let error {
                    ContentUnavailableView("셋리스트를 불러올 수 없어요", systemImage: "list.number", description: Text(error))
                } else { ProgressView() }
            }
            .navigationTitle(String(summary.startedAt.prefix(10)))
            .navigationBarTitleDisplayMode(.inline)
        }
        .task {
            do { detail = try await repository.fetchSetlist(sessionID: summary.sessionId) }
            catch { self.error = "잠시 후 다시 시도해 주세요." }
        }
    }
}
