import Foundation

// Adapted from meloming-ios 18a33bb ChannelRepository/AppClientChannelRepository:
// typed channel responses and a fixed endpoint catalog. Rogichat has one channel.
@MainActor protocol ChannelRepository {
    func fetchChannelDetail(identifier: String) async throws -> ChannelDTO
    func fetchChannelProfile(channelId: Int) async throws -> ChannelProfile
    func fetchChannelFeatureSettings(identifier: String) async throws -> ChannelFeatureSettingsResponse
    func fetchChannelWardrobe(identifier: String) async throws -> ChannelWardrobeResponse
    func fetchFavoritesCount(channelId: Int) async throws -> ChannelFavoritesCountResponse
    func fetchSongs(page: Int, search: String) async throws -> SongsResponse
    func fetchSongs(page: Int, search: String, categoryId: Int?, artistId: Int?, difficulty: Int?) async throws -> SongsResponse
    func fetchCategories() async throws -> [Category]
    func fetchArtists() async throws -> [Artist]
    func fetchSchedules(yearMonth: String) async throws -> SchedulesResponse
    func fetchSetlists(page: Int) async throws -> ChannelSetlistsResponse
    func fetchSetlist(sessionID: Int) async throws -> ChannelSetlistDetail
}

enum ChannelEndpoint {
    case detail, profile, features, wardrobe, favoritesCount, categories, artists
    case songs(page: Int, search: String, categoryId: Int?, artistId: Int?, difficulty: Int?)
    case schedules(yearMonth: String)
    case setlists(page: Int)
    case setlist(sessionID: Int)

    var path: String {
        switch self {
        case .detail: "channel/h66rogi"
        case .profile: "channel/1/profile"
        case .features: "channel/h66rogi/feature-settings"
        case .wardrobe: "channel/h66rogi/wardrobe"
        case .favoritesCount: "favorites/channels/1/count"
        case .categories: "categories/public/h66rogi"
        case .artists: "artists/public/h66rogi"
        case .songs: "songs/channel/h66rogi"
        case .schedules: "schedules/channel/1"
        case .setlists: "song-live/public/setlists"
        case .setlist(let id): "song-live/public/setlists/\(id)"
        }
    }

    var query: [URLQueryItem] {
        switch self {
        case .songs(let page, let search, let categoryId, let artistId, let difficulty):
            return [URLQueryItem(name: "page", value: String(max(1, page))),
                    URLQueryItem(name: "limit", value: "40")]
                + (search.isEmpty ? [] : [URLQueryItem(name: "search", value: search)])
                + (categoryId.map { [URLQueryItem(name: "categoryId", value: String($0))] } ?? [])
                + (artistId.map { [URLQueryItem(name: "artistId", value: String($0))] } ?? [])
                + (difficulty.map { [URLQueryItem(name: "difficulty", value: String($0))] } ?? [])
        case .schedules(let month): return [URLQueryItem(name: "ym", value: month)]
        case .setlists(let page): return [URLQueryItem(name: "identifier", value: "h66rogi"),
                                          URLQueryItem(name: "page", value: String(max(1, page)))]
        case .setlist: return [URLQueryItem(name: "identifier", value: "h66rogi")]
        default: return []
        }
    }
}

@MainActor final class ChannelAPIClient {
    private let environment = NativeEnvironment(rawValue: AppEnvironment().name.rawValue)!
    private let session = URLSession(configuration: NativeAPIClient.configuration(),
                                     delegate: NativeSessionDelegate(), delegateQueue: nil)
    private let maximumBytes = 4 * 1024 * 1024

    func request<Value: Decodable>(_ endpoint: ChannelEndpoint, as type: Value.Type) async throws -> Value {
        var components = URLComponents(url: environment.baseURL.appendingPathComponent(endpoint.path),
                                       resolvingAgainstBaseURL: false)!
        if !endpoint.query.isEmpty { components.queryItems = endpoint.query }
        var request = URLRequest(url: components.url!)
        request.httpMethod = "GET"
        request.httpShouldHandleCookies = false
        request.cachePolicy = .reloadIgnoringLocalCacheData
        request.setValue("application/json", forHTTPHeaderField: "Accept")
        let (bytes, response) = try await session.bytes(for: request)
        defer { bytes.task.cancel() }
        guard let http = response as? HTTPURLResponse, http.url == request.url,
              http.statusCode == 200, http.expectedContentLength <= Int64(maximumBytes) else {
            throw ProductError.invalidResponse
        }
        var data = Data()
        for try await byte in bytes {
            if data.count >= maximumBytes { throw ProductError.invalidResponse }
            data.append(byte)
        }
        return try JSONDecoder().decode(Value.self, from: data)
    }
}

struct AppClientChannelRepository: ChannelRepository {
    private let client = ChannelAPIClient()

    func fetchChannelDetail(identifier: String) async throws -> ChannelDTO {
        try requireIdentifier(identifier)
        return try await client.request(.detail, as: ChannelDTO.self)
    }
    func fetchChannelProfile(channelId: Int) async throws -> ChannelProfile {
        guard channelId == 1 else { throw ProductError.invalidResponse }
        return try await client.request(.profile, as: ChannelProfile.self)
    }
    func fetchChannelFeatureSettings(identifier: String) async throws -> ChannelFeatureSettingsResponse {
        try requireIdentifier(identifier)
        return try await client.request(.features, as: ChannelFeatureSettingsResponse.self)
    }
    func fetchChannelWardrobe(identifier: String) async throws -> ChannelWardrobeResponse {
        try requireIdentifier(identifier)
        return try await client.request(.wardrobe, as: ChannelWardrobeResponse.self)
    }
    func fetchFavoritesCount(channelId: Int) async throws -> ChannelFavoritesCountResponse {
        guard channelId == 1 else { throw ProductError.invalidResponse }
        return try await client.request(.favoritesCount, as: ChannelFavoritesCountResponse.self)
    }
    func fetchSongs(page: Int, search: String) async throws -> SongsResponse {
        try await fetchSongs(page: page, search: search, categoryId: nil, artistId: nil, difficulty: nil)
    }
    func fetchSongs(page: Int, search: String, categoryId: Int?, artistId: Int?, difficulty: Int?) async throws -> SongsResponse {
        try await client.request(.songs(page: page, search: search, categoryId: categoryId,
                                       artistId: artistId, difficulty: difficulty), as: SongsResponse.self)
    }
    func fetchCategories() async throws -> [Category] {
        try await client.request(.categories, as: [Category].self)
    }
    func fetchArtists() async throws -> [Artist] {
        try await client.request(.artists, as: [Artist].self)
    }
    func fetchSchedules(yearMonth: String) async throws -> SchedulesResponse {
        try await client.request(.schedules(yearMonth: yearMonth), as: SchedulesResponse.self)
    }
    func fetchSetlists(page: Int) async throws -> ChannelSetlistsResponse {
        try await client.request(.setlists(page: page), as: ChannelSetlistsResponse.self)
    }
    func fetchSetlist(sessionID: Int) async throws -> ChannelSetlistDetail {
        guard sessionID > 0 else { throw ProductError.invalidResponse }
        return try await client.request(.setlist(sessionID: sessionID), as: ChannelSetlistDetail.self)
    }
    private func requireIdentifier(_ value: String) throws {
        guard value == "h66rogi" else { throw ProductError.invalidResponse }
    }
}

enum ChannelImageURL {
    static func resolve(_ value: String) -> URL? {
        if value.hasPrefix("/") {
            let host = AppEnvironment().name.rawValue == "qa" ? "https://qa.rogi.chat" : "https://rogi.chat"
            return URL(string: host + value)
        }
        guard let url = URL(string: value), url.scheme == "https" else { return nil }
        return url
    }
}

struct ChannelSetlistsResponse: Decodable {
    let setlists: [ChannelSetlistSummary]
    let total: Int
    let page: Int
    let limit: Int
}

// Copied from meloming-ios ChannelDetailView.swift response contract.
struct ChannelFavoritesCountResponse: Decodable { let totalFavorites: Int }

struct ChannelSetlistSummary: Decodable, Identifiable {
    let sessionId: Int
    let startedAt: String
    let completedCount: Int
    let albumArtPreviews: [String]
    var id: Int { sessionId }
}

struct ChannelSetlistDetail: Decodable {
    let summary: ChannelSetlistSummary
    let songs: [ChannelSetlistSong]
}

struct ChannelSetlistSong: Decodable, Identifiable {
    let id: Int
    let title: String
    let artist: String
    let albumArt: String?
}
