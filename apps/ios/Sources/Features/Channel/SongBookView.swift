import SwiftUI

struct SongBookView: View {
    let channelId: Int
    let identifier: String
    private let pinnedSearchText: Binding<String>?

    @StateObject private var viewModel: SongBookViewModel
    @State private var showFilterSheet = false
    @State private var selectedSong: Song?
    @State private var pendingCopyToast: CopyToastModel?

    init(
        channelId: Int,
        identifier: String,
        pinnedSearchText: Binding<String>? = nil
    ) {
        self.channelId = channelId
        self.identifier = identifier
        self.pinnedSearchText = pinnedSearchText
        self._viewModel = StateObject(wrappedValue: SongBookViewModel(channelId: channelId, identifier: identifier))
    }

    var body: some View {
        VStack(spacing: 0) {
            if pinnedSearchText == nil {
                SongBookSearchBar(text: $viewModel.searchText)
                    .padding(.horizontal, 20)
                    .padding(.bottom, 8)
            }

            // Filter Bar
            ScrollView(.horizontal, showsIndicators: false) {
                HStack(spacing: 8) {
                    // Filter Button
                    Button {
                        showFilterSheet = true
                    } label: {
                        HStack(spacing: 4) {
                            Image(systemName: "line.3.horizontal.decrease.circle")
                            if viewModel.hasActiveFilters {
                                Text("\(viewModel.activeFilterCount)")
                                    .font(.caption2.bold())
                            }
                        }
                        .font(.subheadline)
                        .foregroundColor(viewModel.hasActiveFilters ? .white : .primary)
                        .padding(.horizontal, 12)
                        .frame(height: 36)
                        .background(viewModel.hasActiveFilters ? Color.accentColor : Color(.systemGray6))
                        .cornerRadius(18)
                    }

                    // Category Chips
                    CategoryChip(
                        name: "전체",
                        isSelected: viewModel.selectedCategoryId == nil
                    ) {
                        viewModel.selectedCategoryId = nil
                    }

                    ForEach(viewModel.categories, id: \.id) { category in
                        CategoryChip(
                            name: category.name,
                            color: category.color,
                            isSelected: viewModel.selectedCategoryId == category.id
                        ) {
                            viewModel.selectedCategoryId = category.id
                        }
                    }
                }
                .padding(.horizontal)
            }
            .padding(.bottom, 8)

            // Song List
            if viewModel.isLoading && viewModel.songs.isEmpty {
                LoadingView().frame(height: 200)
            } else if viewModel.loadError && viewModel.songs.isEmpty {
                EmptyStateView(icon: "exclamationmark.triangle", title: "노래책을 불러올 수 없어요",
                               message: "잠시 후 다시 시도해 주세요", actionTitle: "다시 시도") {
                    Task { await viewModel.loadSongs() }
                }.frame(height: 200)
            } else if viewModel.songs.isEmpty {
                EmptyStateView(icon: "music.note", title: "노래가 없습니다",
                    message: viewModel.searchText.isEmpty ? "이 채널에 등록된 노래가 없습니다" : "검색 결과가 없습니다")
                    .frame(height: 200)
            } else {
                LazyVStack(spacing: 0) {
                    ForEach(viewModel.songs) { song in
                        SongRow(song: song, onTap: {
                                let text = "\(song.artist.name) - \(song.title)"
                                UIPasteboard.general.string = text
                                UIImpactFeedbackGenerator(style: .light).impactOccurred()
                                pendingCopyToast = CopyToastModel(
                                    title: "클립보드에 복사되었습니다",
                                    description: text
                                )
                                selectedSong = song
                            })
                        .padding(.horizontal)
                        .padding(.vertical, 4)

                        Divider()
                            .padding(.leading, 80)
                    }

                    // Load More
                    if viewModel.hasMore {
                        ProgressView()
                            .frame(maxWidth: .infinity)
                            .padding()
                            .task {
                                await viewModel.loadMore()
                            }
                    }
                }
            }
        }
        .task {
            await viewModel.loadInitialData()
        }
        .onAppear {
            guard let pinnedSearchText else { return }
            viewModel.searchText = pinnedSearchText.wrappedValue
        }
        .onChange(of: viewModel.searchText) { _, value in
            if let pinnedSearchText, pinnedSearchText.wrappedValue != value {
                pinnedSearchText.wrappedValue = value
            }
            viewModel.debounceSearch()
        }
        .onChange(of: pinnedSearchText?.wrappedValue) { _, value in
            guard let value, viewModel.searchText != value else { return }
            viewModel.searchText = value
        }
        .onChange(of: viewModel.selectedCategoryId) { _ in
            Task {
                await viewModel.loadSongs()
            }
        }
        .sheet(isPresented: $showFilterSheet) {
            FilterSheet(viewModel: viewModel)
        }
        .sheet(item: $selectedSong) { song in
            SongDetailSheet(song: song, initialCopyToast: pendingCopyToast)
                .presentationDetents([.large])
        }
        .overlay(alignment: .top) {
            if let pendingCopyToast { CopyToastView(toast: pendingCopyToast).padding(.horizontal, 20).padding(.top, 8) }
        }
        .onChange(of: pendingCopyToast) { _, toast in
            guard toast != nil else { return }
            Task { try? await Task.sleep(for: .seconds(2)); pendingCopyToast = nil }
        }
    }
}

struct FilterSheet: View {
    @ObservedObject var viewModel: SongBookViewModel
    @Environment(\.dismiss) private var dismiss

    // Local state for editing
    @State private var localArtistId: Int?
    @State private var localDifficulty: Int?
    @State private var searchArtist = ""

    var filteredArtists: [Artist] {
        if searchArtist.isEmpty {
            return viewModel.artists
        }
        return viewModel.artists.filter { $0.name.localizedCaseInsensitiveContains(searchArtist) }
    }

    var body: some View {
        NavigationStack {
            List {
                // Difficulty Filter
                Section("난이도") {
                    VStack(spacing: 16) {
                        // Toggle for enabling difficulty filter
                        Toggle(isOn: Binding(
                            get: { localDifficulty != nil },
                            set: { enabled in
                                if enabled {
                                    localDifficulty = 3
                                } else {
                                    localDifficulty = nil
                                }
                            }
                        )) {
                            Text("난이도 필터 사용")
                        }

                        if let difficulty = localDifficulty {
                            VStack(spacing: 12) {
                                // Star display
                                HStack(spacing: 4) {
                                    ForEach(1...5, id: \.self) { level in
                                        Image(systemName: level <= difficulty ? "star.fill" : "star")
                                            .font(.title2)
                                            .foregroundColor(.yellow)
                                    }
                                }

                                // Slider
                                Slider(
                                    value: Binding(
                                        get: { Double(difficulty) },
                                        set: { localDifficulty = Int($0) }
                                    ),
                                    in: 1...5,
                                    step: 1
                                ) {
                                    Text("난이도")
                                } minimumValueLabel: {
                                    Text("1")
                                        .font(.caption)
                                        .foregroundColor(.secondary)
                                } maximumValueLabel: {
                                    Text("5")
                                        .font(.caption)
                                        .foregroundColor(.secondary)
                                }
                            }
                        }
                    }
                    .padding(.vertical, 4)
                }

                // Artist Filter
                Section("가수") {
                    if viewModel.artists.count > 10 {
                        HStack {
                            Image(systemName: "magnifyingglass")
                                .foregroundColor(.secondary)
                            TextField("가수 검색", text: $searchArtist)
                        }
                    }

                    Button {
                        localArtistId = nil
                    } label: {
                        HStack {
                            Text("전체")
                            Spacer()
                            if localArtistId == nil {
                                Image(systemName: "checkmark")
                                    .foregroundColor(.accentColor)
                            }
                        }
                    }
                    .foregroundColor(.primary)

                    ForEach(filteredArtists, id: \.id) { artist in
                        Button {
                            localArtistId = artist.id
                        } label: {
                            HStack {
                                Text(artist.name)
                                if let count = artist.songCount {
                                    Text("\(count)곡")
                                        .font(.caption)
                                        .foregroundColor(.secondary)
                                }
                                Spacer()
                                if localArtistId == artist.id {
                                    Image(systemName: "checkmark")
                                        .foregroundColor(.accentColor)
                                }
                            }
                        }
                        .foregroundColor(.primary)
                    }
                }
            }
            .navigationTitle("필터")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("초기화") {
                        localArtistId = nil
                        localDifficulty = nil
                    }
                }
                ToolbarItem(placement: .confirmationAction) {
                    Button("적용") {
                        viewModel.selectedArtistId = localArtistId
                        viewModel.selectedDifficulty = localDifficulty
                        Task {
                            await viewModel.loadSongs()
                        }
                        dismiss()
                    }
                }
            }
        }
        .presentationDetents([.medium, .large])
        .onAppear {
            localArtistId = viewModel.selectedArtistId
            localDifficulty = viewModel.selectedDifficulty
        }
    }
}

// MARK: - Category Chip
struct CategoryChip: View {
    let name: String
    var color: String? = nil
    let isSelected: Bool
    let onTap: () -> Void

    var body: some View {
        Button(action: onTap) {
            Text(name)
                .font(.subheadline)
                .padding(.horizontal, 16)
                .padding(.vertical, 8)
                .background(isSelected ? Color(hex: color ?? "#6366f1") : Color(.systemGray6))
                .foregroundColor(isSelected ? .white : .primary)
                .cornerRadius(20)
        }
        .buttonStyle(.plain)
    }
}
