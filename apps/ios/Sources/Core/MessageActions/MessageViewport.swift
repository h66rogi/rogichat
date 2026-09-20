import Foundation

enum ViewportMove: Equatable, Sendable { case none, latest, restore(ScrollAnchor) }
/// History insertion preserves visible offset. Only committed new sync IDs count as incoming.
struct MessageViewport {
    private var initialized = false
    private var followsLatest = false
    private var visible: ScrollAnchor?
    private var incoming: Set<String> = []
    var incomingCount: Int { incoming.count }
    mutating func reset() { initialized = false; followsLatest = false; visible = nil; incoming = [] }
    mutating func initialize(restored: ScrollAnchor?) -> ViewportMove {
        guard !initialized else { return .none }
        initialized = true; visible = restored; followsLatest = restored == nil
        return restored.map(ViewportMove.restore) ?? .latest
    }
    mutating func observed(anchor: ScrollAnchor?, atLatest: Bool) {
        visible = anchor; followsLatest = atLatest; if atLatest { incoming = [] }
    }
    func olderPageCommitted() -> ViewportMove { visible.map(ViewportMove.restore) ?? .none }
    mutating func incomingCommitted(_ ids: Set<String>) throws -> ViewportMove {
        guard ids.allSatisfy(actionID) else { throw MessageActionError.invalidResponse }
        guard initialized, !ids.isEmpty else { return .none }
        if followsLatest { return .latest }
        incoming.formUnion(ids); return .none
    }
    mutating func showLatest() -> ViewportMove { followsLatest = true; incoming = []; return .latest }
    mutating func deleted(_ messageId: String) { incoming.remove(messageId); if visible?.messageId == messageId { visible = nil } }
}
