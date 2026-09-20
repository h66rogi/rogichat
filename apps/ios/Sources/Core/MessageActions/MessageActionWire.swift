import Foundation

/// Relative v1 path. Shared transport supplies original scoped credential, no redirects/retries.
struct ActionRequest: Equatable, Sendable {
    let method: String; let path: String; let body: Data?; let successStatus: Int
}
struct ReactionCount: Equatable, Sendable { let emoji: String; let count: Int64 }
struct MessageReactions: Equatable, Sendable { let counts: [ReactionCount]; let mine: String? }
enum MessageActionWire {
    static func mutation(_ permit: ActionPermit) throws -> ActionRequest {
        let record = permit.record; let selection = record.selection
        guard selection.valid else { throw MessageActionError.invalidResponse }
        let path = "rooms/\(selection.scope.roomId)/messages/\(selection.messageId)"
        switch record.action {
        case .report, .blockActor: return try ModerationWire.mutation(record)
        case .delete: return ActionRequest(method: "POST", path: path + "/delete", body: Data("{}".utf8), successStatus: 200)
        case .publish: return ActionRequest(method: "POST", path: path + "/publications", body: Data("{}".utf8), successStatus: 202)
        case .setReaction: return try setReaction(selection, emoji: record.emoji)
        case .removeReaction: return try setReaction(selection, emoji: nil)
        }
    }
    static func publication(_ scope: ActionScope, id: String) throws -> ActionRequest {
        guard scope.valid, actionID(id) else { throw MessageActionError.invalidResponse }
        return ActionRequest(method: "GET", path: "rooms/\(scope.roomId)/publications/\(id)", body: nil, successStatus: 200)
    }
    static func reactions(_ selection: ActionSelection) throws -> ActionRequest {
        guard selection.valid else { throw MessageActionError.invalidResponse }
        return ActionRequest(method: "GET", path: "rooms/\(selection.scope.roomId)/messages/\(selection.messageId)/reactions", body: nil, successStatus: 200)
    }
    static func setReaction(_ selection: ActionSelection, emoji: String?) throws -> ActionRequest {
        guard selection.valid else { throw MessageActionError.invalidResponse }
        let path = "rooms/\(selection.scope.roomId)/messages/\(selection.messageId)/reactions/me"
        guard let emoji else { return ActionRequest(method: "DELETE", path: path, body: Data("{}".utf8), successStatus: 200) }
        guard !emoji.isEmpty, emoji.utf8.count <= 64, emoji.unicodeScalars.count <= 32 else { throw MessageActionError.invalidResponse }
        return ActionRequest(method: "PUT", path: path, body: try JSONSerialization.data(withJSONObject: ["emoji": emoji]), successStatus: 200)
    }
    static func result(_ action: MessageAction, status: Int, data: Data) -> ActionResult {
        do {
            let root = try ActionJSON.object(data)
            if action == .report, status == 200 { return .reported(try ModerationWire.receipt(data)) }
            if action == .blockActor, status == 200 { return .actorBlocked(try ModerationWire.blockReceipt(data)) }
            if action == .delete, status == 200 {
                guard Set(root.keys) == ["requestId", "status"], root["status"] as? String == "blocked",
                      let id = root["requestId"] as? String,
                      id.range(of: "^[0-9a-f]{8}-[0-9a-f]{4}-[45][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$", options: .regularExpression) != nil else { return .unknown }
                return .deleted(id)
            }
            if action == .publish, status == 202 { return try publicationResult(data) }
            if [.setReaction, .removeReaction].contains(action), status == 200 { return .reacted(try reactionResult(data)) }
            guard Set(root.keys) == ["error"], let error = root["error"] as? [String: Any], Set(error.keys) == ["code"], let code = error["code"] as? String else { return .unknown }
            let rejected: [Int: Set<String>] = [400: ["INVALID_REQUEST", "BAD_REQUEST"], 401: ["UNAUTHENTICATED"],
                403: ["FORBIDDEN", "SOOP_LINK_REQUIRED"], 404: ["NOT_FOUND"], 413: ["PAYLOAD_TOO_LARGE"], 429: ["RATE_LIMITED", "BAD_REQUEST"]]
            return rejected[status]?.contains(code) == true ? .rejected : .unknown
        } catch { return .unknown }
    }
    static func publicationResult(_ data: Data) throws -> ActionResult {
        let root = try ActionJSON.object(data)
        guard let raw = root["status"] as? String, let status = ActionPhase(rawValue: raw), [.preparing, .published, .revoked].contains(status),
              Set(root.keys) == (status == .published ? ["publicationId", "status", "messageId"] : ["publicationId", "status"]),
              let id = root["publicationId"] as? String, actionID(id) else { throw MessageActionError.invalidResponse }
        let messageId = root["messageId"] as? String
        if status == .published, messageId.map(actionID) != true { throw MessageActionError.invalidResponse }
        return .publication(id: id, status: status, messageId: messageId)
    }
    static func reactionResult(_ data: Data) throws -> MessageReactions {
        let root = try ActionJSON.object(data)
        guard Set(root.keys) == ["counts", "mine"], let items = root["counts"] as? [[String: Any]],
              root["mine"] is NSNull || root["mine"] is String else { throw MessageActionError.invalidResponse }
        let counts = try items.map { item -> ReactionCount in
            guard Set(item.keys) == ["emoji", "count"], let emoji = item["emoji"] as? String,
                  let number = item["count"] as? NSNumber, CFGetTypeID(number) != CFBooleanGetTypeID(),
                  let count = Int64(number.stringValue), count > 0 else { throw MessageActionError.invalidResponse }
            return ReactionCount(emoji: emoji, count: count)
        }
        guard Set(counts.map(\.emoji)).count == counts.count else { throw MessageActionError.invalidResponse }
        return MessageReactions(counts: counts, mine: root["mine"] as? String)
    }
}
/// Implement on the existing shared client; claim at final serialized HTTP admission.
protocol MessageActionTransport: Sendable {
    func execute(_ request: ActionRequest, permit: ActionPermit) async throws -> ActionResult
}
@MainActor final class MessageActionRunner {
    let state: MessageActionState; let transport: any MessageActionTransport
    init(state: MessageActionState, transport: any MessageActionTransport) { self.state = state; self.transport = transport }
    func execute(_ permit: ActionPermit) async throws -> ActionEffect? {
        let result: ActionResult
        do { result = try await transport.execute(MessageActionWire.mutation(permit), permit: permit) }
        catch { result = .unknown }
        return try state.finish(permit, result: result)
    }
}

import CoreFoundation
/// Bounded structural scan rejects duplicate decoded keys before Foundation parses values.
/// Adapted from the existing native auth strict JSON scanner; no permissive JSON roundtrip.
enum ActionJSON {
    static func object(_ data: Data) throws -> [String: Any] {
        guard data.count <= 1_048_576, String(data: data, encoding: .utf8) != nil else { throw MessageActionError.invalidResponse }
        var scanner = Scanner(bytes: Array(data)); try scanner.value(0); scanner.space()
        guard scanner.index == scanner.bytes.count, let value = try JSONSerialization.jsonObject(with: data) as? [String: Any] else { throw MessageActionError.invalidResponse }
        return value
    }
    private struct Scanner {
        let bytes: [UInt8]; var index = 0
        mutating func space() { while index < bytes.count, [9,10,13,32].contains(bytes[index]) { index += 1 } }
        mutating func take() throws -> UInt8 { guard index < bytes.count else { throw MessageActionError.invalidResponse }; defer { index += 1 }; return bytes[index] }
        mutating func string() throws -> String {
            space(); let start = index; guard try take() == 34 else { throw MessageActionError.invalidResponse }
            while index < bytes.count {
                let c = try take()
                if c == 92 { _ = try take() }
                else if c == 34 { return try JSONDecoder().decode(String.self, from: Data(bytes[start..<index])) }
            }
            throw MessageActionError.invalidResponse
        }
        mutating func value(_ depth: Int) throws {
            guard depth < 32 else { throw MessageActionError.invalidResponse }; space()
            guard index < bytes.count else { throw MessageActionError.invalidResponse }
            switch bytes[index] {
            case 123:
                index += 1; space(); var keys = Set<String>()
                if index < bytes.count, bytes[index] == 125 { index += 1; return }
                while true {
                    guard keys.insert(try string()).inserted else { throw MessageActionError.invalidResponse }
                    space(); guard try take() == 58 else { throw MessageActionError.invalidResponse }
                    try value(depth + 1); space(); let next = try take()
                    if next == 125 { return }; guard next == 44 else { throw MessageActionError.invalidResponse }
                }
            case 91:
                index += 1; space()
                if index < bytes.count, bytes[index] == 93 { index += 1; return }
                while true {
                    try value(depth + 1); space(); let next = try take()
                    if next == 93 { return }; guard next == 44 else { throw MessageActionError.invalidResponse }
                }
            case 34: _ = try string()
            default:
                let start = index
                while index < bytes.count, ![44,93,125,9,10,13,32].contains(bytes[index]) { index += 1 }
                guard index > start else { throw MessageActionError.invalidResponse }
            }
        }
    }
}
