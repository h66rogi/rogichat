import Foundation

struct UpdateChannelRequestBody: Encodable {
    let name: String
    let webPath: String
    let profileImageUrl: String?
    let additionalLinks: [ChannelLink]
    let themeColor: String
    let channelDescription: String?
}

enum ChannelAPIEndpoint {
    case channelSetlists(identifier: String, page: Int)
    case channelSetlist(identifier: String, sessionID: Int)
    case activeLiveSession(identifier: String)
    case activeSession(identifier: String?)
    case addFavorite(channelId: Int)
    case channelArtists(identifier: String)
    case channelCategories(identifier: String)
    case channelCategoriesManage(channelId: Int)
    case channelDetail(identifier: String)
    case channelFavoritesCount(channelId: Int)
    case channelFeatureSettings(identifier: String)
    case channelPermission(identifier: String)
    case channelProfile(channelId: Int)
    case channelSchedules(channelId: Int, yearMonth: String?)
    case channelSongs(channelId: Int, page: Int, limit: Int, categoryId: Int?, artistId: Int?, difficulty: Int?, search: String?)
    case channelWardrobe(identifier: String)
    case checkFavorite(channelId: Int)
    case clearQueue(sessionId: Int)
    case cloneSession(sessionId: Int, identifier: String)
    case consoleQueue(sessionId: Int, includeCompleted: Bool)
    case createCategory(channelId: Int, name: String, color: String)
    case createManualRequest(sessionId: Int, payload: CreateManualRequestPayload)
    case createSchedule(channelId: Int, schedule: CreateScheduleRequest)
    case createSong(channelId: Int, song: CreateSongRequest)
    case createSongRequest(payload: SongRequestPayload)
    case deleteCategory(channelId: Int, categoryId: Int)
    case deleteRequest(requestId: Int)
    case deleteSchedule(scheduleId: Int)
    case deleteSong(channelIdentifier: String, songId: Int)
    case endSession(sessionId: Int)
    case favoriteSongsByChannel(channelId: Int, page: Int, limit: Int)
    case getPricingSettings(channelId: Int)
    case likeSong(id: Int)
    case me
    case nowPlaying(sessionId: Int)
    case playNext(sessionId: Int)
    case playNow(requestId: Int)
    case removeFavorite(channelId: Int)
    case requestedSongIds(sessionId: Int)
    case searchAlbumArt(title: String, artist: String)
    case sessionHistory(identifier: String, page: Int, limit: Int)
    case skipCurrent(sessionId: Int, reason: String?)
    case songRequestQueue(sessionId: Int)
    case startSession(payload: StartSessionPayload)
    case unlikeSong(id: Int)
    case updateCategory(channelId: Int, categoryId: Int, name: String, color: String, displayOrder: Int?)
    case updateChannel(identifier: String, body: UpdateChannelRequestBody)
    case updatePricingSettings(channelId: Int, payload: UpdatePricingSettingsPayload)
    case updateRequestOrder(requestId: Int, newOrder: Int)
    case updateSchedule(scheduleId: Int, schedule: UpdateScheduleRequest)
    case updateSessionSettings(sessionId: Int, payload: UpdateSettingsPayload)
    case updateSong(channelIdentifier: String, songId: Int, song: UpdateSongRequest)

    var path: String {
        switch self {
        case .channelSetlists: return "/v1/song-live/public/setlists"
        case .channelSetlist(_, let id): return "/v1/song-live/public/setlists/\(id)"
        // Auth
        case .me: return "/v1/user/me"
        case .channelDetail(let identifier): return "/v1/channel/\(identifier)"
        case .channelProfile(let channelId): return "/v1/channel/\(channelId)/profile"
        case .channelPermission(let identifier): return "/v1/channel/\(identifier)/permission"
        case .channelFeatureSettings(let identifier):
            let encoded = identifier.addingPercentEncoding(withAllowedCharacters: .urlPathAllowed) ?? identifier
            return "/v1/channel/\(encoded)/feature-settings"
        case .channelWardrobe(let identifier): return "/v1/channel/\(identifier)/wardrobe"
        case .createSong(let channelId, _): return "/v1/songs/channel/\(channelId)"
        case .channelCategories(let identifier): return "/v1/categories/public/\(identifier)"
        case .channelArtists(let identifier): return "/v1/artists/public/\(identifier)"

        // Category Management
        case .channelCategoriesManage(let channelId): return "/v1/categories/channel/\(channelId)/categories"
        case .createCategory(let channelId, _, _): return "/v1/categories/channel/\(channelId)/categories"
        case .updateCategory(let channelId, let categoryId, _, _, _): return "/v1/categories/channel/\(channelId)/categories/\(categoryId)"
        case .deleteCategory(let channelId, let categoryId): return "/v1/categories/channel/\(channelId)/categories/\(categoryId)"

        // Songs
        case .channelSongs(let channelId, _, _, _, _, _, _): return "/v1/songs/channel/\(channelId)"
        case .updateSong(let identifier, let songId, _): return "/v1/songs/channel/\(identifier)/\(songId)"
        case .deleteSong(let identifier, let songId): return "/v1/songs/channel/\(identifier)/\(songId)"
        case .likeSong(let id): return "/v1/favorites/songs/\(id)"
        case .unlikeSong(let id): return "/v1/favorites/songs/\(id)"

        // Favorites
        case .addFavorite(let channelId): return "/v1/favorites/channels/\(channelId)"
        case .removeFavorite(let channelId): return "/v1/favorites/channels/\(channelId)"
        case .checkFavorite(let channelId): return "/v1/favorites/channels/\(channelId)/status"
        case .channelFavoritesCount(let channelId): return "/v1/favorites/channels/\(channelId)/count"
        case .favoriteSongsByChannel(let channelId, _, _): return "/v1/songs/favorites/by-channel/\(channelId)"

        // Schedule
        case .channelSchedules(let channelId, _): return "/v1/schedules/channel/\(channelId)"
        case .createSchedule(let channelId, _): return "/v1/schedules/channel/\(channelId)"
        case .updateSchedule(let scheduleId, _): return "/v1/schedules/\(scheduleId)"
        case .deleteSchedule(let scheduleId): return "/v1/schedules/\(scheduleId)"

        // Content
        case .searchAlbumArt: return "/v1/serper/search"

        // Guestbook
        case .activeLiveSession: return "/v1/song-live/public/active"
        case .createSongRequest,
             .songRequestQueue: return "/v1/song-requests"
        case .requestedSongIds: return "/v1/song-requests/requested-song-ids"

        // Console - Sessions
        case .startSession: return "/v1/song-live/sessions"
        case .activeSession: return "/v1/song-live/sessions/active"
        case .endSession(let sessionId): return "/v1/song-live/sessions/\(sessionId)/end"
        case .updateSessionSettings(let sessionId, _): return "/v1/song-live/sessions/\(sessionId)"
        case .createManualRequest(let sessionId, _): return "/v1/song-live/sessions/\(sessionId)/manual-requests"
        case .sessionHistory: return "/v1/song-live/sessions/history"
        case .cloneSession(let sessionId, _): return "/v1/song-live/sessions/\(sessionId)/clone"

        // Console - Queue
        case .consoleQueue: return "/v1/song-requests"
        case .nowPlaying: return "/v1/song-requests/now-playing"
        case .playNext: return "/v1/song-requests/play-next"
        case .skipCurrent: return "/v1/song-requests/skip-current"
        case .playNow(let requestId): return "/v1/song-requests/\(requestId)/play-now"
        case .updateRequestOrder(let requestId, _): return "/v1/song-requests/\(requestId)/order"
        case .deleteRequest(let requestId): return "/v1/song-requests/\(requestId)"
        case .clearQueue: return "/v1/song-requests/queue"

        // Console - Pricing
        case .getPricingSettings(let channelId): return "/v1/channels/\(channelId)/pricing-settings"
        case .updatePricingSettings(let channelId, _): return "/v1/channels/\(channelId)/pricing-settings"

        // Channel Settings
        case .updateChannel(let identifier, _): return "/v1/channel/\(identifier)"

        }
    }

    var method: ChannelHTTPMethod {
        switch self {
        case .createSong,
             .createSchedule,
             .searchAlbumArt,
             .createCategory,
             .createSongRequest,
             .startSession,
             .endSession,
             .createManualRequest,
             .playNext,
             .skipCurrent,
             .playNow,
             .cloneSession:
            return .POST
        case .likeSong,
             .addFavorite,
             .updateCategory,
             .updateChannel,
             .updatePricingSettings:
            return .PUT
        case .updateSong,
             .updateSchedule,
             .updateSessionSettings,
             .updateRequestOrder:
            return .PATCH
        case .unlikeSong,
             .removeFavorite,
             .deleteCategory,
             .deleteRequest,
             .clearQueue,
             .deleteSchedule,
             .deleteSong:
            return .DELETE
        default:
            return .GET
        }
    }

    var queryItems: [URLQueryItem]? {
        switch self {
        case .channelSetlists(let identifier, let page): return [URLQueryItem(name: "identifier", value: identifier), URLQueryItem(name: "page", value: String(page))]
        case .channelSetlist(let identifier, _): return [URLQueryItem(name: "identifier", value: identifier)]
        case .channelSongs(_, let page, let limit, let categoryId, let artistId, let difficulty, let search):
            var items = [
                URLQueryItem(name: "page", value: "\(page)"),
                URLQueryItem(name: "limit", value: "\(limit)")
            ]
            if let categoryId = categoryId {
                items.append(URLQueryItem(name: "categoryId", value: "\(categoryId)"))
            }
            if let artistId = artistId {
                items.append(URLQueryItem(name: "artistId", value: "\(artistId)"))
            }
            if let difficulty = difficulty {
                items.append(URLQueryItem(name: "difficulty", value: "\(difficulty)"))
            }
            if let search = search, !search.isEmpty {
                items.append(URLQueryItem(name: "search", value: search))
            }
            return items
        case .favoriteSongsByChannel(_, let page, let limit):
            return [
                URLQueryItem(name: "page", value: "\(page)"),
                URLQueryItem(name: "limit", value: "\(limit)")
            ]
        case .channelSchedules(_, let yearMonth):
            if let ym = yearMonth {
                return [URLQueryItem(name: "ym", value: ym)]
            }
            return nil
        case .activeLiveSession(let identifier):
            return [URLQueryItem(name: "identifier", value: identifier)]
        case .songRequestQueue(let sessionId):
            return [
                URLQueryItem(name: "sessionId", value: "\(sessionId)"),
                URLQueryItem(name: "includeCompleted", value: "false")
            ]
        case .requestedSongIds(let sessionId):
            return [URLQueryItem(name: "sessionId", value: "\(sessionId)")]
        case .activeSession(let identifier):
            if let identifier = identifier {
                return [URLQueryItem(name: "identifier", value: identifier)]
            }
            return nil
        case .consoleQueue(let sessionId, let includeCompleted):
            return [
                URLQueryItem(name: "sessionId", value: "\(sessionId)"),
                URLQueryItem(name: "includeCompleted", value: includeCompleted ? "true" : "false")
            ]
        case .nowPlaying(let sessionId):
            return [URLQueryItem(name: "sessionId", value: "\(sessionId)")]
        case .playNext(let sessionId):
            return [URLQueryItem(name: "sessionId", value: "\(sessionId)")]
        case .skipCurrent(let sessionId, let reason):
            var items = [URLQueryItem(name: "sessionId", value: "\(sessionId)")]
            if let reason = reason {
                items.append(URLQueryItem(name: "reason", value: reason))
            }
            return items
        case .clearQueue(let sessionId):
            return [URLQueryItem(name: "sessionId", value: "\(sessionId)")]
        case .sessionHistory(let identifier, let page, let limit):
            return [
                URLQueryItem(name: "identifier", value: identifier),
                URLQueryItem(name: "page", value: "\(page)"),
                URLQueryItem(name: "limit", value: "\(limit)")
            ]
        case .cloneSession(_, let identifier):
            return [URLQueryItem(name: "identifier", value: identifier)]
        default:
            return nil
        }
    }

    var body: Data? {
        switch self {
        case .createSong(_, let song):
            return try? JSONEncoder().encode(song)
        case .updateSong(_, _, let song):
            return try? JSONEncoder().encode(song)
        case .createSchedule(_, let schedule):
            return try? JSONEncoder().encode(schedule)
        case .updateSchedule(_, let schedule):
            return try? JSONEncoder().encode(schedule)
        case .searchAlbumArt(let title, let artist):
            return try? JSONEncoder().encode(["title": title, "artist": artist])
        case .createCategory(_, let name, let color):
            return try? JSONEncoder().encode(["name": name, "color": color])
        case .updateCategory(_, _, let name, let color, let displayOrder):
            var payload: [String: Any] = ["name": name, "color": color]
            if let displayOrder = displayOrder {
                payload["displayOrder"] = displayOrder
            }
            return try? JSONSerialization.data(withJSONObject: payload)
        case .createSongRequest(let payload):
            return try? JSONEncoder().encode(payload)
        case .startSession(let payload):
            return try? JSONEncoder().encode(payload)
        case .updateSessionSettings(_, let payload):
            return try? JSONEncoder().encode(payload)
        case .createManualRequest(_, let payload):
            return try? JSONEncoder().encode(payload)
        case .updateRequestOrder(_, let newOrder):
            return try? JSONEncoder().encode(["newOrder": newOrder])
        case .updatePricingSettings(_, let payload):
            return try? JSONEncoder().encode(payload)
        case .updateChannel(_, let body):
            return try? JSONEncoder().encode(body)
        default:
            return nil
        }
    }
}

enum ChannelHTTPMethod: String { case GET, POST, PUT, PATCH, DELETE }
