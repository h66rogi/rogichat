import Foundation

struct ActionScope: Codable, Equatable, Sendable {
    let environment: String
    let accountId: String
    let sessionEpoch: String
    let roomId: String
    let actorId: String
    let membershipScope: String
    let authorizationRevision: String
    let cacheEpoch: String
    var valid: Bool {
        ["qa", "prod"].contains(environment) && [accountId, sessionEpoch, roomId, actorId, cacheEpoch].allSatisfy(actionID)
            && [membershipScope, authorizationRevision].allSatisfy(MessageReadWire.validContext)
    }
    var partition: [String] { [environment, accountId, roomId, membershipScope] }
}
func actionID(_ value: String) -> Bool {
    value.utf8.count == 36 && value.range(of: "^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$", options: .regularExpression) != nil
}
struct ActionHints: Codable, Equatable, Sendable { let delete: Bool; let publish: Bool }
/// No message body, quote, attachment, nickname or hidden counterpart identity.
/// Optional actor ID comes only from the visible nonanonymous room-author projection.
struct ActionSelection: Codable, Equatable, Sendable {
    let scope: ActionScope
    let messageId: String
    let version: String
    let hints: ActionHints
    let contentKind: String
    let anonymous: Bool
    var visibleActorId: String? = nil
    var valid: Bool { scope.valid && (!anonymous || visibleActorId == nil) && (visibleActorId.map(actionID) ?? true) && actionID(messageId) && version.range(of: "^[1-9][0-9]{0,19}$", options: .regularExpression) != nil && version.utf8.allSatisfy { (48...57).contains($0) } && UInt64(version).map { $0 > 0 } == true }
}
enum MessageAction: String, Codable, Sendable { case delete, publish, setReaction, removeReaction, report, blockActor }
enum ActionPhase: String, Codable, Sendable { case unknown, reported, actorBlocked, reacted, blocked, preparing, published, revoked, rejected }
struct ActionRecord: Codable, Equatable, Sendable {
    let id: String
    var selection: ActionSelection
    let action: MessageAction
    var phase: ActionPhase
    var receiptId: String?
    var publishedMessageId: String?
    var emoji: String?
    var reportReason: ReportReason?
}
/// Parent implements with its account DB transaction; a successful put MUST be durable.
/// UNKNOWN records survive process death, never authorize a replay, and contain no credential/content.
@MainActor protocol ActionJournal {
    func records() throws -> [ActionRecord]
    func put(_ record: ActionRecord) throws
}
enum ActionResult: Sendable, Equatable {
    case deleted(String), publication(id: String, status: ActionPhase, messageId: String?)
    case reacted(MessageReactions), reported(ReportReceipt), actorBlocked(String), rejected, unknown
}
enum ActionEffect: Equatable, Sendable {
    /// Purge content/author/counterpart/quotes/assets/reactions/hints and invalidate linked copies atomically.
    /// Access blocked is not physical erasure. Parent subsequently syncs.
    case accessBlocked(ActionSelection), refresh(ActionSelection), resetRoom(ActionScope)
}
enum MessageActionError: Error { case stale, unavailable, reconcileRequired, invalidResponse }
struct ActionViewToken: Equatable, Sendable {
    let selection: ActionSelection
    fileprivate let generation: UInt64
}
/// The final transport admission must call claim after its actor hop. Do not reuse on retry.
/// Revoke on session/reset/message changes even if the selection later returns A→B→A.
final class ActionPermit: @unchecked Sendable {
    let record: ActionRecord
    private let lock = NSLock()
    private var consumed = false
    private var revoked = false
    fileprivate init(_ record: ActionRecord) { self.record = record }
    func revoke() { lock.withLock { revoked = true } }
    func claim() throws {
        try lock.withLock {
            guard !consumed, !revoked else { throw MessageActionError.stale }
            consumed = true
        }
    }
}
@MainActor final class MessageActionState {
    private let journal: any ActionJournal
    private var generation: UInt64 = 0
    private(set) var selection: ActionSelection?
    private(set) var pending: ActionPermit?
    private(set) var presentation: ActionRecord?
    init(journal: any ActionJournal) { self.journal = journal }
    func select(_ value: ActionSelection?) throws {
        generation &+= 1; pending?.revoke(); pending = nil; selection = nil; presentation = nil
        guard let value else { return }
        guard value.valid else { throw MessageActionError.invalidResponse }
        let record = try journal.records().last { $0.selection.scope.partition == value.scope.partition && $0.selection.messageId == value.messageId }
        selection = value; presentation = record
    }
    func reset() { generation &+= 1; pending?.revoke(); pending = nil; selection = nil; presentation = nil }
    func capture() -> ActionViewToken? { selection.map { ActionViewToken(selection: $0, generation: generation) } }
    func admits(_ token: ActionViewToken) -> Bool { token.generation == generation && token.selection == selection }
    func begin(_ token: ActionViewToken, action: MessageAction, emoji: String? = nil, reportReason: ReportReason? = nil) throws -> ActionPermit {
        guard admits(token), pending == nil else { throw MessageActionError.stale }
        let captured = token.selection
        switch action {
        case .delete: guard captured.hints.delete, !captured.anonymous else { throw MessageActionError.unavailable }
        case .publish: guard captured.hints.publish, !captured.anonymous, ["TEXT", "PHOTO"].contains(captured.contentKind) else { throw MessageActionError.unavailable }
        case .setReaction: guard let emoji, reactionChoices.contains(emoji) else { throw MessageActionError.invalidResponse }
        case .removeReaction: break
        case .report: guard reportReason != nil else { throw MessageActionError.invalidResponse }
        case .blockActor: guard !captured.anonymous, let actor = captured.visibleActorId, actor != captured.scope.actorId else { throw MessageActionError.unavailable }
        }
        if action != .report, reportReason != nil { throw MessageActionError.invalidResponse }
        if action != .setReaction, emoji != nil { throw MessageActionError.invalidResponse }
        guard try !journal.records().contains(where: {
            $0.selection.scope.partition == captured.scope.partition && $0.selection.messageId == captured.messageId
                && [.unknown, .preparing, .blocked, .actorBlocked].contains($0.phase)
        }) else { throw MessageActionError.reconcileRequired }
        let record = ActionRecord(id: UUID().uuidString.lowercased(), selection: captured, action: action, phase: .unknown, emoji: emoji, reportReason: reportReason)
        try journal.put(record)
        let permit = ActionPermit(record); pending = permit; presentation = record; return permit
    }
    func finish(_ permit: ActionPermit, result: ActionResult) throws -> ActionEffect? {
        guard var original = try journal.records().first(where: { $0.id == permit.record.id }), original.phase == .unknown else { return nil }
        switch result {
        case .deleted(let id):
            guard original.action == .delete else { return nil }; original.phase = .blocked; original.receiptId = id; original.selection = original.selection.tombstone
        case .publication(let id, let status, let messageId):
            guard original.action == .publish else { return nil }
            original.phase = status; original.receiptId = id; original.publishedMessageId = messageId
        case .reported(let receipt):
            guard original.action == .report else { return nil }; original.phase = .reported; original.receiptId = receipt.reportId
        case .actorBlocked(let actor):
            guard original.action == .blockActor, original.selection.visibleActorId == actor else { return nil }; original.phase = .actorBlocked
        case .reacted:
            guard [.setReaction, .removeReaction].contains(original.action) else { return nil }; original.phase = .reacted
        case .rejected: original.phase = .rejected
        case .unknown: break
        }
        try journal.put(original) // Always original partition; never a freshly selected account.
        guard pending === permit, selection == permit.record.selection else { return nil }
        pending = nil; presentation = original
        switch original.phase {
        case .actorBlocked: return .resetRoom(original.selection.scope)
        case .blocked: return .accessBlocked(permit.record.selection)
        case .reacted, .published, .revoked: return .refresh(original.selection)
        default: return nil
        }
    }
    /// Accept only an authoritative tombstone already committed in the parent DB.
    func deleted(_ scope: ActionScope, messageId: String) throws {
        for var record in try journal.records() where record.selection.scope.partition == scope.partition && record.selection.messageId == messageId {
            record.phase = .blocked; record.selection = record.selection.tombstone; record.publishedMessageId = nil; try journal.put(record)
        }
        if selection?.scope == scope, selection?.messageId == messageId { reset() }
    }
    func reportStatus(_ token: ActionViewToken, recordId: String, receipt: ReportReceipt) throws -> Bool {
        guard admits(token), var old = try journal.records().first(where: { $0.id == recordId && $0.action == .report &&
            $0.selection.scope.partition == token.selection.scope.partition && $0.selection.messageId == token.selection.messageId }), old.phase == .unknown else { return false }
        old.phase = .reported; old.receiptId = receipt.reportId; try journal.put(old); presentation = old; return true
    }
    func publicationStatus(_ token: ActionViewToken, recordId: String, result: ActionResult) throws -> ActionEffect? {
        guard admits(token), case .publication(let id, let status, let messageId) = result,
              var old = try journal.records().first(where: { $0.id == recordId && $0.selection.scope.partition == token.selection.scope.partition && $0.selection.messageId == token.selection.messageId }),
              [.preparing, .published].contains(old.phase), old.receiptId == id else { return nil }
        if old.phase == .published, status == .preparing { return nil }
        old.phase = status; old.publishedMessageId = messageId
        try journal.put(old); presentation = old
        return [.published, .revoked].contains(status) ? .refresh(token.selection) : nil
    }
}
let reactionChoices = ["👍", "❤️", "😂", "😮", "😢", "👏"]

private extension ActionSelection {
    var tombstone: ActionSelection { ActionSelection(scope: scope, messageId: messageId, version: version,
        hints: ActionHints(delete: false, publish: false), contentKind: "TOMBSTONE", anonymous: true) }
}
