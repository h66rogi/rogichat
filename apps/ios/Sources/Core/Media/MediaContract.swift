import Foundation

// Parent wraps the existing original ConversationScope/account permit. Its check covers
// credential epoch, cache generation, membershipScope and authorizationRevision, never reconstructed IDs.
protocol MediaScope: Sendable {
    var presentationID: String { get }
    var roomID: String? { get }
    func check() throws
}
enum MediaError: Error, Equatable { case invalid, expired, unavailable, processing; case response(Int, String?) }
func mediaID(_ value: String) throws -> String {
    guard value.count == 36, UUID(uuidString: value) != nil else { throw MediaError.invalid }; return value
}
enum MediaKind: String, Codable, Sendable {
    case photo = "PHOTO", video = "VIDEO", avatar = "AVATAR"
    var maximumBytes: Int64 { self == .video ? 50 * 1024 * 1024 : 10 * 1024 * 1024 }
    var contentTypes: Set<String> { self == .video ? ["video/mp4", "video/quicktime"] : ["image/jpeg", "image/png", "image/webp"] }
}
enum MediaStatus: String, Codable, Sendable { case reserved, uploading, processing, ready, deleting, deleted }
struct MediaReceipt: Codable, Sendable, Equatable {
    let assetId: String
    let status: MediaStatus
    func validated(assetID: String? = nil) throws -> Self {
        _ = try mediaID(assetId); guard assetID == nil || assetID == assetId else { throw MediaError.invalid }; return self
    }
}
struct MediaFile: Sendable {
    let url: URL
    let kind: MediaKind
    let contentType: String
    let byteLength: Int64
    init(url: URL, kind: MediaKind, contentType: String) throws {
        let values = try url.resourceValues(forKeys: [.fileSizeKey, .isRegularFileKey, .isSymbolicLinkKey])
        guard url.isFileURL, values.isRegularFile == true, values.isSymbolicLink != true,
              let size = values.fileSize, size > 0, size <= kind.maximumBytes, kind.contentTypes.contains(contentType) else { throw MediaError.invalid }
        self.url = url; self.kind = kind; self.contentType = contentType; self.byteLength = Int64(size)
    }
    func validate() throws {
        let current = try MediaFile(url: url, kind: kind, contentType: contentType)
        guard current.byteLength == byteLength else { throw MediaError.invalid }
    }
    func remove() { try? FileManager.default.removeItem(at: url) }
}
struct MediaIntent: Encodable, Sendable {
    let kind: MediaKind
    let contentType: String
    let byteLength: Int64
    let roomId: String?
    init(file: MediaFile, roomID: String?) throws {
        try file.validate()
        guard (file.kind == .avatar) == (roomID == nil) else { throw MediaError.invalid }
        if let roomID { _ = try mediaID(roomID) }
        kind = file.kind; contentType = file.contentType; byteLength = file.byteLength; roomId = roomID
    }
}
/** Existing outbox owns clientMessageId, intent, recipient and quote. This encodes only content. */
enum MediaContent: Encodable, Sendable {
    case attachments(MediaKind, [MediaReceipt])
    case sticker(String)
    private enum Keys: String, CodingKey { case type, assetIds, stickerId }
    func encode(to encoder: any Encoder) throws {
        var c = encoder.container(keyedBy: Keys.self)
        switch self {
        case .attachments(let kind, let receipts):
            let ids = try receipts.map { try $0.validated().assetId }
            guard kind != .avatar, !ids.isEmpty, ids.count <= (kind == .photo ? 4 : 1),
                  Set(ids).count == ids.count, receipts.allSatisfy({ $0.status == .ready }) else { throw MediaError.invalid }
            try c.encode(kind.rawValue, forKey: .type); try c.encode(ids, forKey: .assetIds)
        case .sticker(let id):
            try c.encode("STICKER", forKey: .type); try c.encode(mediaID(id), forKey: .stickerId)
        }
    }
}
enum MediaVariant: String, Codable, Sendable, Hashable { case image, video, poster }
enum MediaAccess: Sendable, Hashable {
    case preview(MediaVariant)
    case message(room: String, message: String, variant: MediaVariant)
    case avatar(room: String, actor: String)
    case sticker(room: String, sticker: String, message: String?)
    var variant: MediaVariant {
        switch self { case .preview(let v), .message(_, _, let v): v; case .avatar, .sticker: .image }
    }
    var roomID: String? {
        switch self { case .preview: nil; case .message(let r, _, _), .avatar(let r, _), .sticker(let r, _, _): r }
    }
    func body() throws -> Data {
        var values = ["variant": variant.rawValue]
        switch self {
        case .preview: break
        case .message(let room, let message, _): values["roomId"] = try mediaID(room); values["messageId"] = try mediaID(message)
        case .avatar(let room, let actor): values["roomId"] = try mediaID(room); values["actorId"] = try mediaID(actor)
        case .sticker(let room, let sticker, let message):
            values["roomId"] = try mediaID(room); values["stickerId"] = try mediaID(sticker)
            if let message { values["messageId"] = try mediaID(message) }
        }
        return try JSONEncoder().encode(values)
    }
}
struct MediaSticker: Decodable, Sendable, Identifiable { let id: String; let label: String; let assetId: String }
struct MediaStickerPage: Decodable, Sendable { let items: [MediaSticker]; let nextCursor: String? }
// Never Codable: signed URLs must not enter persistent stores, analytics, logs or SEND bodies.
struct MediaLease: Sendable, CustomStringConvertible {
    private let url: URL
    private let deadline: ContinuousClock.Instant
    let variant: MediaVariant
    var description: String { "MediaLease(redacted)" }
    init(url: URL, started: ContinuousClock.Instant, variant: MediaVariant) throws {
        guard url.scheme == "https", url.host != nil, url.user == nil, url.password == nil, url.fragment == nil else { throw MediaError.invalid }
        self.url = url; self.deadline = started.advanced(by: .seconds(55)); self.variant = variant
    }
    func renewalBudget(at now: ContinuousClock.Instant = .now) -> Duration { min(.seconds(5), now.duration(to: deadline)) }
    func needsRenewal(at now: ContinuousClock.Instant = .now) -> Bool { now >= deadline.advanced(by: .seconds(-20)) }
    func checkedURL(scope: any MediaScope) throws -> URL {
        try scope.check(); try Task.checkCancellation()
        guard ContinuousClock.now < deadline else { throw MediaError.expired }; return url
    }
}

struct MediaPresentationIdentity: Hashable { let scopeID: String; let assetID: String; let access: MediaAccess }
