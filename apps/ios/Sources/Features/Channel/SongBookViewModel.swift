import Foundation

@MainActor
final class SongBookViewModel: ObservableObject {
    let channelId: Int
    let identifier: String

    @Published var songs: [Song] = []
    @Published var categories: [Category] = []
    @Published var artists: [Artist] = []
    @Published var searchText = ""
    @Published var selectedCategoryId: Int?
    @Published var selectedArtistId: Int?
    @Published var selectedDifficulty: Int?
    @Published var isLoading = false
    @Published var hasMore = false
    @Published var loadError = false

    private let repository: ChannelRepository
    private var currentPage = 1
    private let pageSize = 40
    private var searchTask: Task<Void, Never>?

    var hasActiveFilters: Bool {
        selectedArtistId != nil || selectedDifficulty != nil
    }

    var activeFilterCount: Int {
        var count = 0
        if selectedArtistId != nil { count += 1 }
        if selectedDifficulty != nil { count += 1 }
        return count
    }

    init(channelId: Int, identifier: String, repository: ChannelRepository = AppClientChannelRepository()) {
        self.channelId = channelId
        self.identifier = identifier
        self.repository = repository
    }

    func loadInitialData() async {
        await withTaskGroup(of: Void.self) { group in
            group.addTask { await self.loadSongs() }
            group.addTask { await self.loadCategories() }
            group.addTask { await self.loadArtists() }
        }
    }

    func loadSongs() async {
        isLoading = true
        loadError = false
        currentPage = 1

        do {
            let response = try await repository.fetchSongs(page: currentPage, search: searchText,
                categoryId: selectedCategoryId, artistId: selectedArtistId, difficulty: selectedDifficulty)
            songs = response.items.map { $0.toDomain() }
            hasMore = songs.count < response.total
        } catch {
            loadError = true
        }

        isLoading = false
    }

    func loadMore() async {
        guard hasMore, !isLoading else { return }

        currentPage += 1

        do {
            let response = try await repository.fetchSongs(page: currentPage, search: searchText,
                categoryId: selectedCategoryId, artistId: selectedArtistId, difficulty: selectedDifficulty)

            songs.append(contentsOf: response.items.map { $0.toDomain() })
            hasMore = songs.count < response.total
        } catch {
            currentPage -= 1
            loadError = true
        }
    }

    private func loadCategories() async {
        do {
            let response = try await repository.fetchCategories()
            // Android와 동일: displayOrder 내림차순 (높은 값 먼저), 같으면 이름순
            categories = response.sorted { a, b in
                let orderA = a.displayOrder ?? Int.min
                let orderB = b.displayOrder ?? Int.min
                if orderA != orderB {
                    return orderA > orderB
                }
                return a.name.localizedCompare(b.name) == .orderedAscending
            }
        } catch {
            categories = []
        }
    }

    private func loadArtists() async {
        do {
            let response = try await repository.fetchArtists()
            // Sort by song count
            artists = response.sorted { ($0.songCount ?? 0) > ($1.songCount ?? 0) }
        } catch {
            artists = []
        }
    }

    func debounceSearch() {
        searchTask?.cancel()

        searchTask = Task {
            try? await Task.sleep(nanoseconds: 300_000_000)
            guard !Task.isCancelled else { return }
            await loadSongs()
        }
    }

}
