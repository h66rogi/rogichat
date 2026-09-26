import Foundation

struct Song: Identifiable, Equatable {
    let id: Int
    let title: String
    let artist: Artist
    let albumArt: String?
    let karaokeUrl: String?
    let coverUrl: String?
    let originalUrl: String?
    let difficulty: Int?
    let proficiency: Int?
    let songKey: String?
    let bpm: Int?
    let lyricsLink: String?
    let lyricsText: String?
    let description: String?
    let price: Int?
    let currencyPrices: [String: Int?]?
    let categories: [Category]
    let isLiked: Bool
    let likeCount: Int
    let createdAt: Date
}

struct Artist: Identifiable, Equatable, Codable {
    let id: Int
    let name: String
    let imageUrl: String?
    var songCount: Int?
}

// Note: Artists API returns array directly, use [Artist].self as response type

struct Category: Identifiable, Equatable, Codable {
    let id: Int
    let name: String
    let color: String?
    var songCount: Int?
    var displayOrder: Int?
    let price: Int?
    let currencyPrices: [String: Int?]?

    init(id: Int, name: String, color: String?, songCount: Int? = nil, displayOrder: Int? = nil, price: Int? = nil, currencyPrices: [String: Int?]? = nil) {
        self.id = id
        self.name = name
        self.color = color
        self.songCount = songCount
        self.displayOrder = displayOrder
        self.price = price
        self.currencyPrices = currencyPrices
    }
}

// Note: Categories API returns array directly, use [Category].self as response type

// MARK: - Song DTO
struct SongDTO: Decodable {
    let id: Int
    let title: String
    let artist: ArtistDTO
    let albumArt: String?
    let karaokeUrl: String?
    let coverUrl: String?
    let originalUrl: String?
    let difficulty: Int?
    let proficiency: Int?
    let songKey: String?
    let bpm: Int?
    let lyricsLink: String?
    let lyricsText: String?
    let description: String?
    let price: Int?
    let currencyPrices: [String: Int?]?
    let songCategories: [SongCategoryDTO]?
    let isLiked: Bool?
    let totalFavorites: Int?
    let _count: SongCountDTO?
    let createdAt: String

    struct ArtistDTO: Decodable {
        let id: Int
        let name: String
        let imageUrl: String?

        func toDomain() -> Artist {
            Artist(id: id, name: name, imageUrl: imageUrl)
        }
    }

    struct SongCategoryDTO: Decodable {
        let category: CategoryDTO

        struct CategoryDTO: Decodable {
            let id: Int
            let name: String
            let color: String?
            let price: Int?
            let currencyPrices: [String: Int?]?

            func toDomain() -> Category {
                Category(id: id, name: name, color: color, price: price, currencyPrices: currencyPrices)
            }
        }
    }

    struct SongCountDTO: Decodable {
        let userLikes: Int?
    }

    enum CodingKeys: String, CodingKey {
        case id
        case title
        case artist
        case albumArt
        case karaokeUrl
        case coverUrl
        case originalUrl
        case difficulty
        case proficiency
        case songKey
        case bpm
        case lyricsLink
        case lyricsText
        case description
        case price
        case currencyPrices
        case songCategories
        case isLiked
        case isFavorite
        case totalFavorites
        case _count
        case createdAt
    }

    init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        id = try container.decode(Int.self, forKey: .id)
        title = try container.decode(String.self, forKey: .title)
        artist = try container.decode(ArtistDTO.self, forKey: .artist)
        albumArt = try container.decodeIfPresent(String.self, forKey: .albumArt)
        karaokeUrl = try container.decodeIfPresent(String.self, forKey: .karaokeUrl)
        coverUrl = try container.decodeIfPresent(String.self, forKey: .coverUrl)
        originalUrl = try container.decodeIfPresent(String.self, forKey: .originalUrl)
        difficulty = try container.decodeIfPresent(Int.self, forKey: .difficulty)
        proficiency = try container.decodeIfPresent(Int.self, forKey: .proficiency)
        songKey = try container.decodeIfPresent(String.self, forKey: .songKey)
        bpm = try container.decodeIfPresent(Int.self, forKey: .bpm)
        lyricsLink = try container.decodeIfPresent(String.self, forKey: .lyricsLink)
        lyricsText = try container.decodeIfPresent(String.self, forKey: .lyricsText)
        description = try container.decodeIfPresent(String.self, forKey: .description)
        price = try container.decodeIfPresent(Int.self, forKey: .price)
        currencyPrices = try container.decodeIfPresent([String: Int?].self, forKey: .currencyPrices)
        songCategories = try container.decodeIfPresent([SongCategoryDTO].self, forKey: .songCategories)
        totalFavorites = try container.decodeIfPresent(Int.self, forKey: .totalFavorites)
        _count = try container.decodeIfPresent(SongCountDTO.self, forKey: ._count)
        createdAt = try container.decode(String.self, forKey: .createdAt)
        isLiked =
            try container.decodeIfPresent(Bool.self, forKey: .isFavorite)
            ?? container.decodeIfPresent(Bool.self, forKey: .isLiked)
    }

    func toDomain() -> Song {
        let dateFormatter = ISO8601DateFormatter()
        dateFormatter.formatOptions = [.withInternetDateTime, .withFractionalSeconds]

        return Song(
            id: id,
            title: title,
            artist: artist.toDomain(),
            albumArt: albumArt,
            karaokeUrl: karaokeUrl,
            coverUrl: coverUrl,
            originalUrl: originalUrl,
            difficulty: difficulty,
            proficiency: proficiency,
            songKey: songKey,
            bpm: bpm,
            lyricsLink: lyricsLink,
            lyricsText: lyricsText,
            description: description,
            price: price,
            currencyPrices: currencyPrices,
            categories: songCategories?.map { $0.category.toDomain() } ?? [],
            isLiked: isLiked ?? false,
            likeCount: _count?.userLikes ?? totalFavorites ?? 0,
            createdAt: dateFormatter.date(from: createdAt) ?? Date()
        )
    }
}

struct SongsResponse: Decodable {
    let items: [SongDTO]
    let total: Int
    let page: Int
    let limit: Int

    enum CodingKeys: String, CodingKey {
        case items = "songs"
        case total
        case page
        case limit
    }
}

// MARK: - Create Song Request
struct CreateSongRequest: Encodable {
    let title: String
    let artistName: String?
    let artistId: Int?
    let categoryNames: [String]?
    let categoryIds: [Int]?
    let difficulty: Int?
    let albumArt: String?
    let songKey: String?
    let bpm: Int?
    let karaokeUrl: String?
    let originalUrl: String?
    let coverUrl: String?
    let lyricsLink: String?
    let lyricsText: String?

    init(
        title: String,
        artistName: String? = nil,
        artistId: Int? = nil,
        categoryNames: [String]? = nil,
        categoryIds: [Int]? = nil,
        difficulty: Int? = nil,
        albumArt: String? = nil,
        songKey: String? = nil,
        bpm: Int? = nil,
        karaokeUrl: String? = nil,
        originalUrl: String? = nil,
        coverUrl: String? = nil,
        lyricsLink: String? = nil,
        lyricsText: String? = nil
    ) {
        self.title = title
        self.artistName = artistName
        self.artistId = artistId
        self.categoryNames = categoryNames
        self.categoryIds = categoryIds
        self.difficulty = difficulty
        self.albumArt = albumArt
        self.songKey = songKey
        self.bpm = bpm
        self.karaokeUrl = karaokeUrl
        self.originalUrl = originalUrl
        self.coverUrl = coverUrl
        self.lyricsLink = lyricsLink
        self.lyricsText = lyricsText
    }
}

// MARK: - Update Song Request
struct UpdateSongRequest: Encodable {
    let title: String?
    let artistName: String?
    let artistId: Int?
    let categoryNames: [String]?
    let categoryIds: [Int]?
    let difficulty: Int?
    let albumArt: String?
    let songKey: String?
    let bpm: Int?
    let karaokeUrl: String?
    let originalUrl: String?
    let coverUrl: String?
    let lyricsLink: String?
    let lyricsText: String?

    init(
        title: String? = nil,
        artistName: String? = nil,
        artistId: Int? = nil,
        categoryNames: [String]? = nil,
        categoryIds: [Int]? = nil,
        difficulty: Int? = nil,
        albumArt: String? = nil,
        songKey: String? = nil,
        bpm: Int? = nil,
        karaokeUrl: String? = nil,
        originalUrl: String? = nil,
        coverUrl: String? = nil,
        lyricsLink: String? = nil,
        lyricsText: String? = nil
    ) {
        self.title = title
        self.artistName = artistName
        self.artistId = artistId
        self.categoryNames = categoryNames
        self.categoryIds = categoryIds
        self.difficulty = difficulty
        self.albumArt = albumArt
        self.songKey = songKey
        self.bpm = bpm
        self.karaokeUrl = karaokeUrl
        self.originalUrl = originalUrl
        self.coverUrl = coverUrl
        self.lyricsLink = lyricsLink
        self.lyricsText = lyricsText
    }
}

// MARK: - Channel Permission Response
struct ChannelPermissionResponse: Decodable {
    let view: Bool
    let manageContent: Bool
    let manageSettings: Bool
    let isOwner: Bool
}
