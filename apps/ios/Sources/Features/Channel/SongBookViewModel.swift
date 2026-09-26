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
    @Published var isFavoriteMode = false
    @Published var isLoading = false
    @Published var hasMore = false
    @Published var permission: ChannelPermissionResponse?
    @Published var pricingSettings: PricingSettings?

    private let client: ChannelAPIClient
    private var currentPage = 1
    private let pageSize = 30
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

    init(channelId: Int, identifier: String, client: ChannelAPIClient = .shared) {
        self.channelId = channelId
        self.identifier = identifier
        self.client = client
    }

    func loadInitialData() async {
        async let songsTask: () = loadSongs()
        async let categoriesTask: () = loadCategories()
        async let artistsTask: () = loadArtists()
        async let permissionTask: () = loadPermission()
        async let pricingTask: () = loadPricingSettings()

        _ = await (songsTask, categoriesTask, artistsTask, permissionTask, pricingTask)
    }

    private func loadPricingSettings() async {
        do {
            let response: PricingSettingsDTO = try await client.request(
                endpoint: .getPricingSettings(channelId: channelId),
                responseType: PricingSettingsDTO.self
            )
            pricingSettings = response.toDomain()
        } catch {
        }
    }

    private func loadPermission() async {
        guard ChannelSession.shared.isAuthenticated else { return }

        do {
            let response = try await client.request(
                endpoint: .channelPermission(identifier: identifier),
                responseType: ChannelPermissionResponse.self
            )
            permission = response
        } catch {
        }
    }

    func updateSong(_ song: Song) {
        if let index = songs.firstIndex(where: { $0.id == song.id }) {
            songs[index] = song
        }
    }

    func loadSongs() async {
        isLoading = true
        currentPage = 1

        do {
            if isFavoriteMode {
                // Load favorite songs
                let response = try await client.request(
                    endpoint: .favoriteSongsByChannel(
                        channelId: channelId,
                        page: currentPage,
                        limit: pageSize
                    ),
                    responseType: SongsResponse.self
                )
                songs = response.items.map { $0.toDomain() }
                hasMore = false // Favorite mode doesn't support pagination for now
            } else {
                // Load normal songs with filters
                let response = try await client.request(
                    endpoint: .channelSongs(
                        channelId: channelId,
                        page: currentPage,
                        limit: pageSize,
                        categoryId: selectedCategoryId,
                        artistId: selectedArtistId,
                        difficulty: selectedDifficulty,
                        search: searchText.isEmpty ? nil : searchText
                    ),
                    responseType: SongsResponse.self
                )

                songs = response.items.map { $0.toDomain() }
                hasMore = response.items.count == pageSize
            }
        } catch {
        }

        isLoading = false
    }

    func loadMore() async {
        guard hasMore, !isLoading, !isFavoriteMode else { return }

        currentPage += 1

        do {
            let response = try await client.request(
                endpoint: .channelSongs(
                    channelId: channelId,
                    page: currentPage,
                    limit: pageSize,
                    categoryId: selectedCategoryId,
                    artistId: selectedArtistId,
                    difficulty: selectedDifficulty,
                    search: searchText.isEmpty ? nil : searchText
                ),
                responseType: SongsResponse.self
            )

            songs.append(contentsOf: response.items.map { $0.toDomain() })
            hasMore = response.items.count == pageSize
        } catch {
            currentPage -= 1
        }
    }

    private func loadCategories() async {
        do {
            let response = try await client.request(
                endpoint: .channelCategories(identifier: identifier),
                responseType: [Category].self
            )
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
        }
    }

    private func loadArtists() async {
        do {
            let response = try await client.request(
                endpoint: .channelArtists(identifier: identifier),
                responseType: [Artist].self
            )
            // Sort by song count
            artists = response.sorted { ($0.songCount ?? 0) > ($1.songCount ?? 0) }
        } catch {
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

    func toggleLike(song: Song) async {
        guard ChannelSession.shared.isAuthenticated else { return }

        guard let index = songs.firstIndex(where: { $0.id == song.id }) else { return }

        let wasLiked = songs[index].isLiked
        songs[index] = Song(
            id: song.id,
            title: song.title,
            artist: song.artist,
            albumArt: song.albumArt,
            karaokeUrl: song.karaokeUrl,
            coverUrl: song.coverUrl,
            originalUrl: song.originalUrl,
            difficulty: song.difficulty,
            proficiency: song.proficiency,
            songKey: song.songKey,
            bpm: song.bpm,
            lyricsLink: song.lyricsLink,
            lyricsText: song.lyricsText,
            description: song.description,
            price: song.price,
            currencyPrices: song.currencyPrices,
            categories: song.categories,
            isLiked: !wasLiked,
            likeCount: wasLiked ? song.likeCount - 1 : song.likeCount + 1,
            createdAt: song.createdAt
        )

        do {
            if wasLiked {
                try await client.requestWithoutResponse(
                    endpoint: .unlikeSong(id: song.id)
                )
            } else {
                try await client.requestWithoutResponse(
                    endpoint: .likeSong(id: song.id)
                )
            }
        } catch {
            songs[index] = song
        }
    }
}
