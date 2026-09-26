import Foundation

@MainActor
final class AddSongViewModel: ObservableObject {
    let channelId: Int
    let identifier: String

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
    @Published var errorMessage: String?

    private let client: ChannelAPIClient

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

    init(channelId: Int, identifier: String, client: ChannelAPIClient = .shared) {
        self.channelId = channelId
        self.identifier = identifier
        self.client = client
    }

    func loadData() async {
        await withTaskGroup(of: Void.self) { group in
            group.addTask { await self.loadCategories() }
            group.addTask { await self.loadArtists() }
        }
    }

    private func loadCategories() async {
        do {
            let response = try await client.request(
                endpoint: .channelCategories(identifier: identifier),
                responseType: [Category].self
            )
            categories = response
        } catch {
        }
    }

    private func loadArtists() async {
        do {
            let response = try await client.request(
                endpoint: .channelArtists(identifier: identifier),
                responseType: [Artist].self
            )
            artists = response
        } catch {
        }
    }

    func toggleCategory(_ name: String) {
        if selectedCategories.contains(name) {
            selectedCategories.remove(name)
        } else {
            selectedCategories.insert(name)
        }
    }

    func createSong() async -> Bool {
        isLoading = true
        errorMessage = nil

        // Build category names
        var categoryNames = Array(selectedCategories)
        let newCategories = newCategoryName
            .split(separator: ",")
            .map { $0.trimmingCharacters(in: .whitespacesAndNewlines) }
            .filter { !$0.isEmpty }
        categoryNames.append(contentsOf: newCategories)

        let request = CreateSongRequest(
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
            _ = try await client.request(
                endpoint: .createSong(channelId: channelId, song: request),
                responseType: SongDTO.self
            )
            isLoading = false
            return true
        } catch let error as ChannelAPIError {
            isLoading = false
            switch error {
            case .clientError(let statusCode, let message):
                if statusCode == 403 {
                    errorMessage = "노래를 추가할 권한이 없습니다."
                } else if statusCode == 409 || message.contains("중복") || message.contains("duplicate") {
                    errorMessage = "이미 등록된 노래입니다."
                } else {
                    errorMessage = message
                }
            case .unauthorized:
                errorMessage = "로그인이 필요합니다."
            default:
                errorMessage = error.errorDescription ?? "노래 추가에 실패했습니다."
            }
            return false
        } catch {
            isLoading = false
            errorMessage = "노래 추가에 실패했습니다."
            return false
        }
    }
}
