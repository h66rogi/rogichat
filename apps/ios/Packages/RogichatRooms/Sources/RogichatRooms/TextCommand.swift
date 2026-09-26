import Foundation

public struct TextCommand: Codable, Equatable, Identifiable, Sendable {
    public let id: String
    public let roomID: String
    public let membershipScope: String
    public let intent: String
    public let recipientActorID: String?
    public let quoteID: String?
    public let text: String
    public let attachmentContent: OutgoingAttachment?
    public init(roomID: String, membershipScope: String, recipientActorID: String? = nil, quoteID: String? = nil, toRoomOwner: Bool = false, attachment: OutgoingAttachment) throws {
        guard !toRoomOwner || (recipientActorID == nil && quoteID == nil) else { throw ConversationError.invalidText }
        guard RoomsWire.uuid(roomID), RoomsWire.token(membershipScope), recipientActorID.map(RoomsWire.uuid) ?? true, quoteID.map(RoomsWire.uuid) ?? true else { throw ConversationError.invalidText }
        try attachment.validate()
        id = UUID().uuidString.lowercased(); self.roomID = roomID; self.membershipScope = membershipScope
        intent = toRoomOwner ? "ROOM_OWNER" : recipientActorID == nil ? "SHARED" : "PRIVATE"; self.recipientActorID = recipientActorID; self.quoteID = quoteID
        text = ""; attachmentContent = attachment
    }
    public init(roomID: String, membershipScope: String, recipientActorID: String? = nil, quoteID: String? = nil, toRoomOwner: Bool = false, text: String) throws {
        guard !toRoomOwner || (recipientActorID == nil && quoteID == nil) else { throw ConversationError.invalidText }
        guard RoomsWire.uuid(roomID), RoomsWire.token(membershipScope), recipientActorID.map(RoomsWire.uuid) ?? true, quoteID.map(RoomsWire.uuid) ?? true else { throw ConversationError.invalidText }
        self.id = UUID().uuidString.lowercased(); self.roomID = roomID; self.membershipScope = membershipScope
        self.intent = toRoomOwner ? "ROOM_OWNER" : recipientActorID == nil ? "SHARED" : "PRIVATE"; self.recipientActorID = recipientActorID; self.quoteID = quoteID; self.text = try ConversationWire.normalizedText(text); attachmentContent = nil
    }
    enum CodingKeys: CodingKey { case id, roomID, membershipScope, intent, recipientActorID, quoteID, text, attachmentContent }
    public init(from decoder: any Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        id = try c.decode(String.self, forKey: .id); roomID = try c.decode(String.self, forKey: .roomID); membershipScope = try c.decode(String.self, forKey: .membershipScope)
        intent = try c.decode(String.self, forKey: .intent); recipientActorID = try c.decodeIfPresent(String.self, forKey: .recipientActorID); quoteID = try c.decodeIfPresent(String.self, forKey: .quoteID); text = try c.decode(String.self, forKey: .text); attachmentContent = try c.decodeIfPresent(OutgoingAttachment.self, forKey: .attachmentContent)
        guard RoomsWire.uuid(id), RoomsWire.uuid(roomID), RoomsWire.token(membershipScope), quoteID.map(RoomsWire.uuid) ?? true,
              (intent == "SHARED" && recipientActorID == nil) || (intent == "PRIVATE" && recipientActorID.map(RoomsWire.uuid) == true) ||
              (intent == "ROOM_OWNER" && recipientActorID == nil && quoteID == nil),
              (attachmentContent == nil ? try ConversationWire.normalizedText(text) == text : text.isEmpty) else { throw ConversationError.persistence }
        try attachmentContent?.validate()
    }
    // Only the server's command fields; never local scope, partition or timestamps.
    public func requestBody() throws -> Data {
        var value: [String: Any] = ["clientMessageId": id, "membershipScope": membershipScope, "intent": intent, "content": ["type": "TEXT", "text": text]]
        if let attachmentContent {
            try attachmentContent.validate()
            value["content"] = try JSONSerialization.jsonObject(with: JSONEncoder().encode(attachmentContent))
        }
        if let recipientActorID { value["recipientActorId"] = recipientActorID }
        if let quoteID { value["quoteId"] = quoteID }
        return try JSONSerialization.data(withJSONObject: value, options: [.sortedKeys])
    }
}
public enum TextCommandPhase: String, Codable, Sendable { case queued, sending, unknown, committed, deleted, rejected, blocked }
public struct StoredTextCommand: Equatable, Identifiable, Sendable {
    public let id: String
    public let phase: TextCommandPhase
    public let command: TextCommand?
    public let messageID: String?
    public let version: MessageVersion?
    public var notice: String {
        switch phase {
        case .queued, .sending: "보내는 중"
        case .unknown: "보냈는지 확인하고 있어요."
        case .committed: "접수됨"
        case .deleted: ""
        case .rejected: "메시지를 보내지 못했어요."
        case .blocked: "메시지를 보내지 못했어요."
        }
    }
}
// SEND and lookup intentionally use different deleted variants.
public enum SendReceipt: Decodable, Sendable {
    case committed(commandID: String, messageID: String, version: MessageVersion)
    case deleted(commandID: String, messageID: String)
    enum CodingKeys: String, CodingKey, Hashable { case clientMessageId, messageId, status, version }
    public init(from decoder: any Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        let id = try c.decode(String.self, forKey: .clientMessageId); let message = try c.decode(String.self, forKey: .messageId)
        guard RoomsWire.uuid(id), RoomsWire.uuid(message) else { throw ConversationError.invalidResponse }
        switch try c.decode(String.self, forKey: .status) {
        case "committed":
            guard Set(c.allKeys) == [.clientMessageId, .messageId, .status, .version] else { throw ConversationError.invalidResponse }
            self = .committed(commandID: id, messageID: message, version: try c.decode(MessageVersion.self, forKey: .version))
        case "deleted":
            guard Set(c.allKeys) == [.clientMessageId, .messageId, .status] else { throw ConversationError.invalidResponse }
            self = .deleted(commandID: id, messageID: message)
        default: throw ConversationError.invalidResponse
        }
    }
    public var commandID: String { switch self { case .committed(let id, _, _), .deleted(let id, _): id } }
}
public enum CommandReceipt: Decodable, Sendable {
    case committed(commandID: String, messageID: String, version: MessageVersion)
    case deleted(commandID: String)
    enum CodingKeys: String, CodingKey, Hashable { case clientMessageId, messageId, status, version }
    public init(from decoder: any Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        let id = try c.decode(String.self, forKey: .clientMessageId); guard RoomsWire.uuid(id) else { throw ConversationError.invalidResponse }
        switch try c.decode(String.self, forKey: .status) {
        case "committed":
            guard Set(c.allKeys) == [.clientMessageId, .messageId, .status, .version] else { throw ConversationError.invalidResponse }
            let message = try c.decode(String.self, forKey: .messageId); guard RoomsWire.uuid(message) else { throw ConversationError.invalidResponse }
            self = .committed(commandID: id, messageID: message, version: try c.decode(MessageVersion.self, forKey: .version))
        case "deleted":
            guard Set(c.allKeys) == [.clientMessageId, .status] else { throw ConversationError.invalidResponse }
            self = .deleted(commandID: id)
        default: throw ConversationError.invalidResponse
        }
    }
    public var commandID: String { switch self { case .committed(let id, _, _), .deleted(let id): id } }
}

// Shares the original durable command/receipt machinery; media URLs never enter the outbox.
public struct OutgoingAttachment: Codable, Equatable, Sendable {
    public let type: String
    public let assetIds: [String]?
    public let stickerId: String?
    public let caption: String?
    public init(type: String, assetIds: [String]? = nil, stickerId: String? = nil, caption: String? = nil) throws {
        self.type = type; self.assetIds = assetIds; self.stickerId = stickerId; self.caption = caption; try validate()
    }
    public func validate() throws {
        switch type {
        case "PHOTO", "VIDEO":
            guard stickerId == nil, let assetIds, !assetIds.isEmpty, assetIds.count <= (type == "PHOTO" ? 4 : 1), Set(assetIds).count == assetIds.count, assetIds.allSatisfy(RoomsWire.uuid) else { throw ConversationError.invalidText }
            if let caption { guard (try? ConversationWire.normalizedText(caption)) == caption else { throw ConversationError.invalidText } }
        case "STICKER": guard assetIds == nil, stickerId.map(RoomsWire.uuid) == true, caption == nil else { throw ConversationError.invalidText }
        default: throw ConversationError.invalidText
        }
    }
}
