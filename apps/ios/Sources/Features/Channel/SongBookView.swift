import SwiftUI
import Kingfisher

struct SongBookView: View {
    let channelId: Int
    let identifier: String
    let refreshToken: UUID

    @StateObject private var viewModel: SongBookViewModel
    @ObservedObject var songRequestManager: SongRequestManager
    var onShowQueue: (() -> Void)?
    @State private var showFilterSheet = false
    @State private var selectedSong: Song?
    @State private var songToEdit: Song?
    @State private var showRequestSuccess = false
    @State private var showDeleteConfirmation = false
    @State private var songToDelete: Song?
    @State private var deleteError: String?
    @State private var showDeleteError = false

    init(channelId: Int, identifier: String, refreshToken: UUID = UUID(), songRequestManager: SongRequestManager, onShowQueue: (() -> Void)? = nil) {
        self.channelId = channelId
        self.identifier = identifier
        self.refreshToken = refreshToken
        self.songRequestManager = songRequestManager
        self.onShowQueue = onShowQueue
        self._viewModel = StateObject(wrappedValue: SongBookViewModel(channelId: channelId, identifier: identifier))
    }

    var body: some View {
        VStack(spacing: 0) {
            // Search Bar
            HStack {
                Image(systemName: "magnifyingglass")
                    .foregroundColor(.secondary)

                TextField("노래 검색", text: $viewModel.searchText)
                    .textFieldStyle(.plain)

                if !viewModel.searchText.isEmpty {
                    Button(action: { viewModel.searchText = "" }) {
                        Image(systemName: "xmark.circle.fill")
                            .foregroundColor(.secondary)
                    }
                }
            }
            .padding(12)
            .background(Color(.systemGray6))
            .cornerRadius(10)
            .padding(.horizontal)
            .padding(.bottom, 8)

            // Filter Bar
            ScrollView(.horizontal, showsIndicators: false) {
                HStack(spacing: 8) {
                    // Favorites Only Button
                    Button {
                        viewModel.isFavoriteMode.toggle()
                    } label: {
                        Image(systemName: viewModel.isFavoriteMode ? "heart.fill" : "heart")
                            .font(.subheadline)
                            .foregroundColor(viewModel.isFavoriteMode ? .white : .red)
                            .frame(width: 36, height: 36)
                            .background(viewModel.isFavoriteMode ? Color.red : Color(.systemGray6))
                            .cornerRadius(18)
                    }

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

            // Live Song Request Banner
            if songRequestManager.showRequestUI {
                LiveSongRequestBanner(manager: songRequestManager)
                    .contentShape(Rectangle())
                    .onTapGesture { onShowQueue?() }
            }

            // Song List
            if viewModel.isLoading && viewModel.songs.isEmpty {
                LoadingView()
            } else if viewModel.songs.isEmpty {
                EmptyStateView(
                    icon: viewModel.isFavoriteMode ? "heart.slash" : "music.note",
                    title: viewModel.isFavoriteMode ? "좋아요한 곡이 없습니다" : "노래가 없습니다",
                    message: viewModel.isFavoriteMode
                        ? "하트를 눌러 좋아하는 곡을 저장해보세요"
                        : (viewModel.searchText.isEmpty ? "이 채널에 등록된 노래가 없습니다" : "검색 결과가 없습니다")
                )
            } else {
                LazyVStack(spacing: 0) {
                    ForEach(viewModel.songs) { song in
                        SongRow(
                            song: song,
                            onTap: { selectedSong = song },
                            onLikeToggle: {
                                Task { await viewModel.toggleLike(song: song) }
                            },
                            songRequestManager: songRequestManager.showRequestUI ? songRequestManager : nil,
                            onRequest: {
                                Task {
                                    let success = await songRequestManager.requestSong(song)
                                    if success { showRequestSuccess = true }
                                }
                            }
                        )
                        .padding(.horizontal)
                        .padding(.vertical, 4)

                        Divider()
                            .padding(.leading, 80)
                    }

                    // Load More
                    if viewModel.hasMore && !viewModel.isFavoriteMode {
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
        .alert("신청 완료", isPresented: $showRequestSuccess) {
            Button("확인", role: .cancel) {}
        } message: {
            Text("신청곡이 등록되었습니다")
        }
        .alert("오류", isPresented: Binding(
            get: { songRequestManager.requestError != nil },
            set: { if !$0 { songRequestManager.requestError = nil } }
        )) {
            Button("확인", role: .cancel) {}
        } message: {
            Text(songRequestManager.requestError ?? "")
        }
        .onChange(of: viewModel.searchText) { _ in
            viewModel.debounceSearch()
        }
        .onChange(of: viewModel.selectedCategoryId) { _ in
            Task {
                await viewModel.loadSongs()
            }
        }
        .onChange(of: viewModel.isFavoriteMode) { _ in
            Task {
                await viewModel.loadSongs()
            }
        }
        .onChange(of: refreshToken) { _ in
            Task {
                await viewModel.loadSongs()
            }
        }
        .sheet(isPresented: $showFilterSheet) {
            FilterSheet(viewModel: viewModel)
        }
        .sheet(item: $selectedSong) { song in
            SongDetailSheet(
                song: song,
                channelIdentifier: identifier,
                permission: viewModel.permission,
                pricingSettings: viewModel.pricingSettings,
                songRequestManager: songRequestManager.showRequestUI ? songRequestManager : nil,
                onRequest: {
                    Task {
                        let success = await songRequestManager.requestSong(song)
                        if success {
                            showRequestSuccess = true
                            selectedSong = nil
                        }
                    }
                },
                onLikeToggle: {
                    Task {
                        await viewModel.toggleLike(song: song)
                        // Update selected song's like status
                        if let updatedSong = viewModel.songs.first(where: { $0.id == song.id }) {
                            selectedSong = updatedSong
                        }
                    }
                },
                onEdit: {
                    selectedSong = nil
                    DispatchQueue.main.asyncAfter(deadline: .now() + 0.3) {
                        songToEdit = song
                    }
                },
                onDelete: {
                    selectedSong = nil
                    DispatchQueue.main.asyncAfter(deadline: .now() + 0.3) {
                        songToDelete = song
                        showDeleteConfirmation = true
                    }
                },
                onSongUpdated: { updatedSong in
                    viewModel.updateSong(updatedSong)
                    selectedSong = updatedSong
                }
            )
            .presentationDetents([.large])
        }
        .sheet(item: $songToEdit) { song in
            EditSongView(
                channelId: channelId,
                identifier: identifier,
                song: song,
                onComplete: { updatedSong in
                    viewModel.updateSong(updatedSong)
                    songToEdit = nil
                    // Optionally re-open detail sheet
                    DispatchQueue.main.asyncAfter(deadline: .now() + 0.3) {
                        selectedSong = updatedSong
                    }
                },
                onDelete: {
                    songToEdit = nil
                    Task {
                        await viewModel.loadSongs()
                    }
                }
            )
        }
        .alert("노래 삭제", isPresented: $showDeleteConfirmation) {
            Button("삭제", role: .destructive) {
                if let song = songToDelete {
                    Task {
                        do {
                            try await ChannelAPIClient.shared.requestWithoutResponse(
                                endpoint: .deleteSong(channelIdentifier: identifier, songId: song.id)
                            )
                            await viewModel.loadSongs()
                        } catch {
                            deleteError = "노래를 삭제할 수 없습니다."
                            showDeleteError = true
                        }
                    }
                }
            }
            Button("취소", role: .cancel) {}
        } message: {
            Text("이 노래를 삭제하시겠습니까? 이 작업은 되돌릴 수 없습니다.")
        }
        .alert("오류", isPresented: $showDeleteError) {
            Button("확인") { deleteError = nil }
        } message: {
            if let error = deleteError { Text(error) }
        }
    }
}

// MARK: - Filter Sheet
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

// MARK: - Live Song Request Banner
private struct LiveSongRequestBanner: View {
    @ObservedObject var manager: SongRequestManager

    var body: some View {
        HStack(spacing: 8) {
            Image(systemName: "antenna.radiowaves.left.and.right")
                .foregroundColor(.white)

            Text(manager.isPaused ? "신청곡 일시정지" : "신청곡 받는 중")
                .font(.subheadline.weight(.medium))
                .foregroundColor(.white)

            Spacer()

            if manager.maxQueueSize > 0 {
                Text("대기열 \(manager.queueCount)/\(manager.maxQueueSize)")
                    .font(.caption)
                    .foregroundColor(.white.opacity(0.9))
            }

            if manager.isQueueFull {
                Text("가득")
                    .font(.caption2.bold())
                    .padding(.horizontal, 6)
                    .padding(.vertical, 2)
                    .background(.white.opacity(0.3))
                    .cornerRadius(4)
                    .foregroundColor(.white)
            }

            Image(systemName: "chevron.right")
                .font(.caption)
                .foregroundColor(.white.opacity(0.7))
        }
        .padding(.horizontal, 16)
        .padding(.vertical, 10)
        .background(
            LinearGradient(
                colors: [Color.purple, Color.pink],
                startPoint: .leading,
                endPoint: .trailing
            )
        )
    }
}

// MARK: - Song Row
struct SongRow: View {
    let song: Song
    var onTap: (() -> Void)?
    var onLikeToggle: (() -> Void)?
    var songRequestManager: SongRequestManager?
    var onRequest: (() -> Void)?

    var body: some View {
        Button(action: { onTap?() }) {
            HStack(spacing: 12) {
                // Album Art
                KFImage(ChannelEnvironment.imageURL(song.albumArt ?? ""))
                    .placeholder {
                        RoundedRectangle(cornerRadius: 8)
                            .fill(Color.gray.opacity(0.2))
                            .overlay(
                                Image(systemName: "music.note")
                                    .foregroundColor(.gray)
                            )
                    }
                    .resizable()
                    .aspectRatio(contentMode: .fill)
                    .frame(width: 56, height: 56)
                    .cornerRadius(8)

                // Info
                VStack(alignment: .leading, spacing: 4) {
                    Text(song.title)
                        .font(.subheadline.weight(.medium))
                        .foregroundColor(.primary)
                        .lineLimit(1)

                    HStack(spacing: 6) {
                        Text(song.artist.name)
                            .font(.caption)
                            .foregroundColor(.secondary)
                            .lineLimit(1)

                        if let difficulty = song.difficulty, difficulty > 0 {
                            HStack(spacing: 1) {
                                ForEach(1...difficulty, id: \.self) { _ in
                                    Image(systemName: "star.fill")
                                        .font(.system(size: 8))
                                        .foregroundColor(.yellow)
                                }
                            }
                        }
                    }

                    // Categories
                    if !song.categories.isEmpty {
                        HStack(spacing: 4) {
                            ForEach(song.categories.prefix(2)) { category in
                                Text(category.name)
                                    .font(.caption2)
                                    .padding(.horizontal, 6)
                                    .padding(.vertical, 2)
                                    .background(Color(hex: category.color ?? "#6b7280").opacity(0.2))
                                    .foregroundColor(Color(hex: category.color ?? "#6b7280"))
                                    .cornerRadius(4)
                            }
                        }
                    }
                }

                Spacer()

                // Song Request Button
                if let manager = songRequestManager, let onRequest {
                    let blocked = manager.isBlockedCategory(song: song)
                    let duplicate = manager.isDuplicateRequest(songId: song.id)
                    let canSubmit = manager.canRequest && !manager.isSubmitting && !blocked && !duplicate
                    Button(action: onRequest) {
                        Text(songRequestButtonLabel(manager: manager, isBlockedCategory: blocked, isDuplicateRequest: duplicate))
                            .font(.caption.bold())
                            .padding(.horizontal, 10)
                            .padding(.vertical, 6)
                            .background(canSubmit ? Color.purple : Color.gray.opacity(0.3))
                            .foregroundColor(canSubmit ? .white : .secondary)
                            .cornerRadius(6)
                    }
                    .buttonStyle(.plain)
                    .disabled(!canSubmit)
                }

                // Like Button
                if let onLikeToggle = onLikeToggle {
                    Button(action: onLikeToggle) {
                        VStack(spacing: 2) {
                            Image(systemName: song.isLiked ? "heart.fill" : "heart")
                                .foregroundColor(song.isLiked ? .red : .secondary)
                            if song.likeCount > 0 {
                                Text("\(song.likeCount)")
                                    .font(.caption2)
                                    .foregroundColor(.secondary)
                            }
                        }
                    }
                    .buttonStyle(.plain)
                }
            }
            .padding(.vertical, 4)
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
    }

    private func songRequestButtonLabel(manager: SongRequestManager, isBlockedCategory: Bool = false, isDuplicateRequest: Bool = false) -> String {
        if isBlockedCategory { return "신청 불가" }
        if isDuplicateRequest { return "신청됨" }
        if manager.isSubmitting { return "신청중" }
        if manager.isPaused { return "일시정지" }
        if manager.isQueueFull { return "대기열 가득" }
        return "신청"
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
