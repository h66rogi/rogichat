import Foundation

struct ReadSnapshot: Equatable, Sendable { let context: String; let messageIds: [String] }
struct ScrollAnchor: Codable, Equatable, Sendable { let messageId: String; let offset: Int }
@MainActor protocol ScrollAnchorStore {
    func load(_ scope: ActionScope) throws -> ScrollAnchor?
    func save(_ scope: ActionScope, anchor: ScrollAnchor?) throws
}
struct ReadViewToken: Equatable, Sendable { let scope: ActionScope; fileprivate let generation: UInt64 }
final class ReadDisplayPermit: @unchecked Sendable {
    let token: ReadViewToken; let messageId: String; let context: String
    private let lock = NSLock(); private var used = false; private var revoked = false
    fileprivate init(token: ReadViewToken, messageId: String, context: String) { self.token = token; self.messageId = messageId; self.context = context }
    func revoke() { lock.withLock { revoked = true } }
    func claim() throws { try lock.withLock { guard !used, !revoked else { throw MessageActionError.stale }; used = true } }
    func request() throws -> ActionRequest {
        ActionRequest(method: "PUT", path: "rooms/\(token.scope.roomId)/read-state",
            body: try JSONSerialization.data(withJSONObject: ["messageId": messageId, "readContext": context]), successStatus: 200)
    }
}
/// No read reporting on restore. Only a newly visible row after a fresh GET may issue one PUT.
@MainActor final class MessageReadPosition {
    private let anchors: any ScrollAnchorStore
    private var generation: UInt64 = 0
    private var scope: ActionScope?
    private var context: String?
    private(set) var pending: ReadDisplayPermit?
    private(set) var savedMessageIds: [String] = []
    private(set) var needsRefresh = true
    init(anchors: any ScrollAnchorStore) { self.anchors = anchors }
    func select(_ value: ActionScope?) {
        generation &+= 1; pending?.revoke(); pending = nil; scope = value; context = nil; savedMessageIds = []; needsRefresh = true
    }
    func capture() -> ReadViewToken? { scope.map { ReadViewToken(scope: $0, generation: generation) } }
    private func admits(_ token: ReadViewToken) -> Bool { token.scope == scope && token.generation == generation }
    func accept(_ token: ReadViewToken, snapshot: ReadSnapshot) throws -> Bool {
        guard admits(token), pending == nil, context == nil, needsRefresh else { return false }
        guard MessageReadWire.validContext(snapshot.context), snapshot.messageIds.count <= 100, snapshot.messageIds.allSatisfy(actionID) else { throw MessageActionError.invalidResponse }
        context = snapshot.context; savedMessageIds = snapshot.messageIds; needsRefresh = false; return true
    }
    func displayed(_ token: ReadViewToken, messageId: String) throws -> ReadDisplayPermit? {
        guard actionID(messageId) else { throw MessageActionError.invalidResponse }
        guard admits(token), pending == nil, !needsRefresh, let context else { return nil }
        let permit = ReadDisplayPermit(token: token, messageId: messageId, context: context); pending = permit; return permit
    }
    /// For unknown or 409, discard context/queued updates and require GET. Never automatically retry PUT.
    func finish(_ permit: ReadDisplayPermit, acknowledged: Bool, savedMessageId: String?) throws -> Bool {
        guard admits(permit.token), pending === permit else { return false }
        if let savedMessageId, !actionID(savedMessageId) { throw MessageActionError.invalidResponse }
        pending = nil
        if !acknowledged { generation &+= 1; context = nil; needsRefresh = true; savedMessageIds = [] }
        else if let savedMessageId, !savedMessageIds.contains(savedMessageId) { savedMessageIds.append(savedMessageId); savedMessageIds = Array(savedMessageIds.suffix(100)) }
        return true
    }
    func saveAnchor(_ token: ReadViewToken, anchor: ScrollAnchor, currentlyReadable: Set<String>) throws {
        guard actionID(anchor.messageId), anchor.offset >= 0 else { throw MessageActionError.invalidResponse }
        if admits(token), currentlyReadable.contains(anchor.messageId) { try anchors.save(token.scope, anchor: anchor) }
    }
    func restoreAnchor(_ token: ReadViewToken, currentlyReadable: Set<String>) throws -> ScrollAnchor? {
        guard admits(token), let anchor = try anchors.load(token.scope) else { return nil }
        guard actionID(anchor.messageId), anchor.offset >= 0, currentlyReadable.contains(anchor.messageId) else { try anchors.save(token.scope, anchor: nil); return nil }
        return anchor
    }
    func deleted(_ messageId: String) throws {
        guard let scope else { return }
        if try anchors.load(scope)?.messageId == messageId { try anchors.save(scope, anchor: nil) }
        savedMessageIds.removeAll { $0 == messageId }
        if pending?.messageId == messageId { pending?.revoke(); pending = nil; generation &+= 1; context = nil; needsRefresh = true }
    }
    func reset() throws { if let scope { try anchors.save(scope, anchor: nil) }; select(nil) }
}
enum MessageReadWire {
    static func validContext(_ value: String) -> Bool { value.utf8.count == 43 && value.range(of: "^[A-Za-z0-9_-]{42}[AEIMQUYcgkosw048]$", options: .regularExpression) != nil }
    static func get(_ scope: ActionScope) throws -> ActionRequest {
        guard scope.valid else { throw MessageActionError.invalidResponse }
        return ActionRequest(method: "GET", path: "rooms/\(scope.roomId)/read-state", body: nil, successStatus: 200)
    }
    static func snapshot(_ data: Data) throws -> ReadSnapshot {
        let root = try ActionJSON.object(data)
        guard Set(root.keys) == ["readContext", "items"], let context = root["readContext"] as? String, validContext(context),
              let items = root["items"] as? [[String: Any]], items.count <= 100 else { throw MessageActionError.invalidResponse }
        let ids = try items.map { item -> String in
            guard Set(item.keys) == ["messageId"], let id = item["messageId"] as? String, actionID(id) else { throw MessageActionError.invalidResponse }; return id
        }
        return ReadSnapshot(context: context, messageIds: ids)
    }
    static func saved(_ data: Data) throws -> String? {
        let root = try ActionJSON.object(data)
        guard Set(root.keys) == ["messageId"] else { throw MessageActionError.invalidResponse }
        if root["messageId"] is NSNull { return nil }
        guard let id = root["messageId"] as? String, actionID(id) else { throw MessageActionError.invalidResponse }; return id
    }
}
