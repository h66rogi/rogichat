import Foundation

@MainActor
final class EditSongViewModel: ObservableObject {
    let channelId: Int
    let identifier: String
    let songId: Int

    // Required fields
    @Published var title = ""
    @Published var artistName = ""
    @Published var selectedCategories: Set<String> = []
    @Published var newCategoryName = ""
    @Published var difficulty = 3

    // Optional fields
    @Published var albumArt = ""
    @Published var songKey = ""
    @Published var bpmString = ""
    @Published var karaokeUrl = ""
    @Published var originalUrl = ""
    @Published var coverUrl = ""
    @Published var lyricsLink = ""
    @Published var lyricsText = ""

    // Data
    @Published var categories: [Category] = []
    @Published var artists: [Artist] = []

    // State
    @Published var isLoading = false
    @Published var isInitialLoading = true
    @Published var errorMessage: String?
    @Published var loadError: String?
    @Published var showDeleteAlert = false

    private let client: ChannelAPIClient

    // Original song data for comparison
    private let originalSong: Song

    var isValid: Bool {
        let hasTitle = !title.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
        let hasArtist = !artistName.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
        let hasCategory = !selectedCategories.isEmpty || !newCategoryName.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
        return hasTitle && hasArtist && hasCategory
    }

    var canSearchAlbumArt: Bool {
        !title.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty &&
        !artistName.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
    }

    var filteredArtists: [Artist] {
        let query = artistName.trimmingCharacters(in: .whitespacesAndNewlines).lowercased()
        if query.isEmpty {
            return artists
        }
        return artists.filter { $0.name.lowercased().contains(query) }
    }

    init(channelId: Int, identifier: String, song: Song, client: ChannelAPIClient = .shared) {
        self.channelId = channelId
        self.identifier = identifier
        self.songId = song.id
        self.originalSong = song
        self.client = client

        // Initialize with song data
        self.title = song.title
        self.artistName = song.artist.name
        self.selectedCategories = Set(song.categories.map { $0.name })
        self.difficulty = song.difficulty ?? 3
        self.albumArt = song.albumArt ?? ""
        self.songKey = song.songKey ?? ""
        self.bpmString = song.bpm.map { String($0) } ?? ""
        self.karaokeUrl = song.karaokeUrl ?? ""
        self.originalUrl = song.originalUrl ?? ""
        self.coverUrl = song.coverUrl ?? ""
        self.lyricsLink = song.lyricsLink ?? ""
        self.lyricsText = song.lyricsText ?? ""
    }

    func loadData() async {
        isInitialLoading = true
        loadError = nil

        var categoriesError: Error?
        var artistsError: Error?

        do {
            categories = try await client.request(endpoint: .channelCategories(identifier: identifier), responseType: [Category].self)
        } catch { categoriesError = error }
        do {
            artists = try await client.request(endpoint: .channelArtists(identifier: identifier), responseType: [Artist].self)
        } catch { artistsError = error }

        // 둘 다 실패한 경우에만 에러 표시
        if categoriesError != nil && artistsError != nil {
            loadError = "카테고리와 아티스트 정보를 불러오는데 실패했습니다.\n네트워크 연결을 확인해주세요."
        }

        isInitialLoading = false
    }

    func toggleCategory(_ name: String) {
        if selectedCategories.contains(name) {
            selectedCategories.remove(name)
        } else {
            selectedCategories.insert(name)
        }
    }

    func updateSong() async -> Song? {
        isLoading = true
        errorMessage = nil

        // Build category names
        var categoryNames = Array(selectedCategories)
        let newCategories = newCategoryName
            .split(separator: ",")
            .map { $0.trimmingCharacters(in: .whitespacesAndNewlines) }
            .filter { !$0.isEmpty }
        categoryNames.append(contentsOf: newCategories)

        let request = UpdateSongRequest(
            title: title.trimmingCharacters(in: .whitespacesAndNewlines),
            artistName: artistName.trimmingCharacters(in: .whitespacesAndNewlines),
            categoryNames: categoryNames.isEmpty ? nil : categoryNames,
            difficulty: difficulty,
            albumArt: albumArt.isEmpty ? nil : albumArt,
            songKey: songKey.isEmpty ? nil : songKey,
            bpm: Int(bpmString),
            karaokeUrl: karaokeUrl.isEmpty ? nil : karaokeUrl,
            originalUrl: originalUrl.isEmpty ? nil : originalUrl,
            coverUrl: coverUrl.isEmpty ? nil : coverUrl,
            lyricsLink: lyricsLink.isEmpty ? nil : lyricsLink,
            lyricsText: lyricsText.isEmpty ? nil : lyricsText
        )

        do {
            let response = try await client.request(
                endpoint: .updateSong(channelIdentifier: identifier, songId: songId, song: request),
                responseType: SongDTO.self
            )
            isLoading = false
            return response.toDomain()
        } catch let error as ChannelAPIError {
            isLoading = false
            switch error {
            case .clientError(let statusCode, let message):
                if statusCode == 403 {
                    errorMessage = "노래를 수정할 권한이 없습니다."
                } else {
                    errorMessage = message
                }
            case .unauthorized:
                errorMessage = "로그인이 필요합니다."
            default:
                errorMessage = error.errorDescription ?? "노래 수정에 실패했습니다."
            }
            return nil
        } catch {
            isLoading = false
            errorMessage = "노래 수정에 실패했습니다."
            return nil
        }
    }

    func deleteSong() async -> Bool {
        isLoading = true
        errorMessage = nil

        do {
            try await client.requestWithoutResponse(
                endpoint: .deleteSong(channelIdentifier: identifier, songId: songId)
            )
            isLoading = false
            return true
        } catch let error as ChannelAPIError {
            isLoading = false
            switch error {
            case .clientError(let statusCode, let message):
                if statusCode == 403 {
                    errorMessage = "노래를 삭제할 권한이 없습니다."
                } else {
                    errorMessage = message
                }
            case .unauthorized:
                errorMessage = "로그인이 필요합니다."
            default:
                errorMessage = error.errorDescription ?? "노래 삭제에 실패했습니다."
            }
            return false
        } catch {
            isLoading = false
            errorMessage = "노래 삭제에 실패했습니다."
            return false
        }
    }
}
