import SwiftUI

// Adapted from meloming-ios 18a33bb ChannelDetailView.swift. The profile hero,
// pinned section rail, feature-settings resolution and tab composition remain native.
struct ChannelDetailView: View {
    let identifier: String
    let onTalk: () -> Void
    @StateObject private var viewModel: ChannelDetailViewModel
    @State private var selectedTab: ChannelTab = .songBook

    struct ChannelResolvedTab: Identifiable, Equatable {
        let tab: ChannelTab
        let label: String
        var id: ChannelTab { tab }
        var icon: String { tab.icon }
    }

    enum ChannelTab: String, Hashable {
        case songBook = "노래책", schedule = "캘린더", setlist = "셋리스트", wardrobe = "옷장"
        var icon: String {
            switch self {
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
            [ChannelTab.songBook, .schedule, .setlist, .wardrobe]
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
        .navigationTitle("채널")
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
        case .songBook: ChannelSongBookView()
        case .schedule: ChannelScheduleView()
        case .setlist: ChannelSetlistView()
        case .wardrobe: ChannelWardrobeView(identifier: identifier)
        }
    }
}

// SongBookView's searchable list/empty/error structure, with Rogichat's public song contract.
private struct ChannelSongBookView: View {
    @State private var searchText = ""
    @State private var songs: [Song] = []
    @State private var total = 0
    @State private var page = 1
    @State private var loading = true
    @State private var error: String?
    private let repository: ChannelRepository = AppClientChannelRepository()

    var body: some View {
        VStack(spacing: 12) {
            SongBookSearchBar(text: $searchText).padding(.horizontal, 20)
            if loading && songs.isEmpty { ProgressView().padding(.top, 42) }
            else if let error, songs.isEmpty {
                ContentUnavailableView("노래책을 불러올 수 없어요", systemImage: "music.note", description: Text(error))
                Button("다시 시도") { Task { await load() } }.buttonStyle(.bordered)
            } else if songs.isEmpty {
                ContentUnavailableView("등록된 노래가 없어요", systemImage: "music.note.list")
            } else {
                LazyVStack(spacing: 0) {
                    ForEach(songs) { song in
                        HStack(spacing: 12) {
                            AsyncImage(url: song.albumArt.flatMap(ChannelImageURL.resolve)) { image in
                                image.resizable().scaledToFill()
                            } placeholder: {
                                RoundedRectangle(cornerRadius: 8).fill(.quaternary)
                                    .overlay { Image(systemName: "music.note") }
                            }
                            .frame(width: 56, height: 56).clipShape(RoundedRectangle(cornerRadius: 8))
                            VStack(alignment: .leading, spacing: 4) {
                                Text(song.title).font(.subheadline.weight(.medium)).lineLimit(1)
                                Text(song.artist.name).font(.caption).foregroundStyle(.secondary)
                            }
                            Spacer()
                        }
                        .padding(.horizontal, 20).padding(.vertical, 7)
                        Divider().padding(.leading, 88)
                    }
                    if songs.count < total {
                        Button(loading ? "불러오는 중" : "노래 더 보기") { Task { await loadMore() } }
                            .disabled(loading).padding(.vertical, 16)
                    }
                }
            }
        }
        .task(id: searchText) {
            try? await Task.sleep(for: .milliseconds(250))
            guard !Task.isCancelled else { return }
            await load()
        }
    }

    private func load() async {
        loading = true; error = nil
        do {
            let response = try await repository.fetchSongs(page: 1, search: searchText)
            guard !Task.isCancelled else { return }
            songs = response.items.map { $0.toDomain() }
            total = response.total; page = 1
        } catch { if !Task.isCancelled { self.error = "잠시 후 다시 시도해 주세요." } }
        guard !Task.isCancelled else { return }
        loading = false
    }
    private func loadMore() async {
        guard !loading, songs.count < total else { return }
        loading = true; error = nil
        do {
            let response = try await repository.fetchSongs(page: page + 1, search: searchText)
            guard !Task.isCancelled else { return }
            songs.append(contentsOf: response.items.map { $0.toDomain() })
            total = response.total; page += 1
        } catch { if !Task.isCancelled { self.error = "노래를 더 불러올 수 없어요." } }
        guard !Task.isCancelled else { return }
        loading = false
    }
}

// ScheduleView's month navigation and grouped ScheduleRow presentation.
private struct ChannelScheduleView: View {
    @State private var month = Date()
    @State private var schedules: [Schedule] = []
    @State private var loading = true
    @State private var error: String?
    private let repository: ChannelRepository = AppClientChannelRepository()

    private var monthKey: String {
        let formatter = DateFormatter(); formatter.dateFormat = "yyyy-MM"
        formatter.timeZone = TimeZone(identifier: "Asia/Seoul")
        return formatter.string(from: month)
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 14) {
            HStack {
                Button { moveMonth(-1) } label: { Image(systemName: "chevron.left") }.accessibilityLabel("이전 달")
                Spacer()
                Text(monthKey).font(.headline)
                Spacer()
                Button { moveMonth(1) } label: { Image(systemName: "chevron.right") }.accessibilityLabel("다음 달")
            }.padding(.horizontal, 20).padding(.top, 8)
            if loading && schedules.isEmpty { ProgressView().frame(maxWidth: .infinity).padding(.top, 42) }
            else if let error, schedules.isEmpty {
                ContentUnavailableView("일정을 불러올 수 없어요", systemImage: "calendar", description: Text(error))
                Button("다시 시도") { Task { await load() } }.buttonStyle(.bordered)
            } else if schedules.isEmpty { ContentUnavailableView("이달의 일정이 없어요", systemImage: "calendar") }
            else {
                LazyVStack(alignment: .leading, spacing: 12) {
                    ForEach(schedules.sorted(by: { $0.startAt < $1.startAt })) { schedule in
                        ScheduleRow(schedule: schedule)
                        Divider()
                    }
                }.padding(.horizontal, 20)
            }
        }
        .task(id: monthKey) { await load() }
    }

    private func moveMonth(_ amount: Int) {
        month = Calendar(identifier: .gregorian).date(byAdding: .month, value: amount, to: month) ?? month
    }
    private func load() async {
        loading = true; error = nil
        do { schedules = try await repository.fetchSchedules(yearMonth: monthKey).items.map { $0.toDomain() } }
        catch { self.error = "잠시 후 다시 시도해 주세요." }
        loading = false
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
