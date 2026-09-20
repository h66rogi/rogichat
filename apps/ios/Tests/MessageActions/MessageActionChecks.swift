import Foundation

@MainActor final class DiskJournal: ActionJournal {
    let url: URL
    var fail = false
    init(_ url: URL) { self.url = url }
    func records() throws -> [ActionRecord] {
        guard FileManager.default.fileExists(atPath: url.path) else { return [] }
        return try JSONDecoder().decode([ActionRecord].self, from: Data(contentsOf: url))
    }
    func put(_ record: ActionRecord) throws {
        if fail { throw MessageActionError.unavailable }
        var values = try records(); values.removeAll { $0.id == record.id }; values.append(record)
        try JSONEncoder().encode(values).write(to: url, options: .atomic)
    }
}
@MainActor final class TestAnchors: ScrollAnchorStore {
    var values: [[String]: ScrollAnchor] = [:]
    func load(_ scope: ActionScope) -> ScrollAnchor? { values[scope.partition + [scope.authorizationRevision]] }
    func save(_ scope: ActionScope, anchor: ScrollAnchor?) { values[scope.partition + [scope.authorizationRevision]] = anchor }
}
@main struct MessageActionChecks {
    static let a = "11111111-1111-4111-8111-111111111111"
    static let b = "22222222-2222-4222-8222-222222222222"
    static let c = "33333333-3333-4333-8333-333333333333"
    static let d = "44444444-4444-4444-8444-444444444444"
    static func data(_ text: String) -> Data { Data(text.utf8) }
    @MainActor static func main() throws {
        var checks = 0
        func check(_ value: Bool) { precondition(value); checks += 1 }
        func rejects(_ action: () throws -> Void) { do { try action(); preconditionFailure("expected rejection") } catch { checks += 1 } }
        let scope = ActionScope(environment: "qa", accountId: a, sessionEpoch: b, roomId: c, actorId: a, membershipScope: String(repeating: "A", count: 43), authorizationRevision: String(repeating: "B", count: 42) + "A", cacheEpoch: d)
        let selected = ActionSelection(scope: scope, messageId: b, version: "1", hints: ActionHints(delete: true, publish: true), contentKind: "TEXT", anonymous: false, visibleActorId: b)
        let temp = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        try FileManager.default.createDirectory(at: temp, withIntermediateDirectories: true)
        defer { try? FileManager.default.removeItem(at: temp) }
        let journal = DiskJournal(temp.appendingPathComponent("journal.json"))
        let state = MessageActionState(journal: journal)
        try state.select(selected); let stale = state.capture()!
        state.reset(); try state.select(selected)
        rejects { _ = try state.begin(stale, action: .delete) } // A→B→A stale dialog.
        let permit = try state.begin(state.capture()!, action: .delete)
        check(try MessageActionWire.mutation(permit).path == "rooms/\(c)/messages/\(b)/delete")
        state.reset(); try state.select(selected)
        rejects { try permit.claim() } // Queued actor hop revoked.
        check(try state.finish(permit, result: .deleted(d)) == nil) // Late callback never updates current UI.
        let recovered = MessageActionState(journal: DiskJournal(journal.url))
        try recovered.select(selected); check(recovered.presentation?.phase == .blocked); check(recovered.presentation?.selection.visibleActorId == nil); check(recovered.presentation?.selection.hints.delete == false)
        rejects { _ = try recovered.begin(recovered.capture()!, action: .publish) }
        try FileManager.default.removeItem(at: journal.url)
        try state.select(selected)
        let reaction = try state.begin(state.capture()!, action: .setReaction, emoji: "👍")
        try reaction.claim(); rejects { try reaction.claim() }
        check(try state.finish(reaction, result: .unknown) == nil)
        rejects { _ = try state.begin(state.capture()!, action: .removeReaction) } // Reverse while unknown forbidden.
        let reopened = MessageActionState(journal: DiskJournal(journal.url)); try reopened.select(selected)
        rejects { _ = try reopened.begin(reopened.capture()!, action: .setReaction, emoji: "❤️") }
        try FileManager.default.removeItem(at: journal.url)
        journal.fail = true; try state.select(selected)
        rejects { _ = try state.begin(state.capture()!, action: .delete) }; check(state.pending == nil); journal.fail = false
        var anonymous = selected; anonymous = ActionSelection(scope: scope, messageId: b, version: "1", hints: selected.hints, contentKind: "TEXT", anonymous: true)
        try state.select(anonymous)
        rejects { _ = try state.begin(state.capture()!, action: .publish) }
        rejects { _ = try state.begin(state.capture()!, action: .blockActor) }
        let report = try state.begin(state.capture()!, action: .report, reportReason: .spam)
        check(try ModerationWire.recoverReport(report.record).path == "report-receipts/\(report.record.id)")
        check(try state.finish(report, result: .unknown) == nil)
        let receipt = try ModerationWire.receipt(data("{\"reportId\":\"\(d)\",\"status\":\"received\",\"createdAt\":\"2026-09-20T00:00:00.000Z\"}"))
        check(try state.reportStatus(state.capture()!, recordId: report.record.id, receipt: receipt))
        check(MessageActionWire.result(.delete, status: 503, data: data("{\"error\":{\"code\":\"UNAVAILABLE\"}}")) == .unknown)
        check(MessageActionWire.result(.delete, status: 200, data: data("{\"requestId\":\"\(d)\",\"status\":\"blocked\",\"status\":\"blocked\"}")) == .unknown)
        check(MessageActionWire.result(.delete, status: 200, data: data("{\"requestId\":\"\(d)\",\"status\":\"blocked\"}")) == .deleted(d))
        check(MessageActionWire.result(.publish, status: 202, data: data("{\"publicationId\":\"\(d)\",\"status\":\"preparing\"}")) == .publication(id: d, status: .preparing, messageId: nil))
        rejects { _ = try MessageActionWire.publicationResult(data("{\"publicationId\":\"\(d)\",\"status\":\"preparing\",\"messageId\":\"\(b)\"}")) }
        rejects { _ = try MessageActionWire.reactionResult(data("{\"counts\":[{\"emoji\":\"👍\",\"count\":true}],\"mine\":null}")) }
        check(try MessageActionWire.reactionResult(data("{\"counts\":[{\"emoji\":\"👍\",\"count\":1}],\"mine\":null}")).counts.count == 1)
        let position = MessageReadPosition(anchors: TestAnchors()); position.select(scope); let readToken = position.capture()!
        let context = String(repeating: "A", count: 43)
        check(try position.accept(readToken, snapshot: ReadSnapshot(context: context, messageIds: [b])))
        let read = try position.displayed(readToken, messageId: b)!; try read.claim()
        check(try position.finish(read, acknowledged: false, savedMessageId: nil)); check(position.needsRefresh)
        check(try position.displayed(readToken, messageId: b) == nil)
        check(try !position.accept(readToken, snapshot: ReadSnapshot(context: context, messageIds: [b])))
        let fresh = position.capture()!; check(try position.accept(fresh, snapshot: ReadSnapshot(context: context, messageIds: [])))
        check(try !position.accept(fresh, snapshot: ReadSnapshot(context: context, messageIds: [b])))
        try position.saveAnchor(fresh, anchor: ScrollAnchor(messageId: b, offset: 22), currentlyReadable: [b])
        check(try position.restoreAnchor(fresh, currentlyReadable: [b])?.offset == 22)
        check(try position.restoreAnchor(fresh, currentlyReadable: []) == nil)
        rejects { _ = try MessageReadWire.snapshot(data("{\"readContext\":\"\(context)\",\"items\":[{\"messageId\":null}]}")) }
        check(try MessageReadWire.saved(data("{\"messageId\":null}")) == nil)
        var viewport = MessageViewport(); let anchor = ScrollAnchor(messageId: b, offset: 22)
        check(viewport.initialize(restored: anchor) == .restore(anchor))
        check(viewport.olderPageCommitted() == .restore(anchor))
        check(try viewport.incomingCommitted([d]) == .none); check(viewport.incomingCount == 1)
        check(try viewport.incomingCommitted([d]) == .none); check(viewport.incomingCount == 1)
        check(viewport.showLatest() == .latest); check(viewport.incomingCount == 0)
        check(try viewport.incomingCommitted([c]) == .latest)
        try FileManager.default.removeItem(at: journal.url); try state.select(selected)
        let publish = try state.begin(state.capture()!, action: .publish); try publish.claim()
        check(try state.finish(publish, result: .publication(id: d, status: .preparing, messageId: nil)) == nil)
        state.reset(); try state.select(selected); let publicationToken = state.capture()!
        check(try state.publicationStatus(publicationToken, recordId: publish.record.id, result: .publication(id: d, status: .published, messageId: c)) == .refresh(selected))
        check(try state.publicationStatus(publicationToken, recordId: publish.record.id, result: .publication(id: d, status: .preparing, messageId: nil)) == nil)
        check(try state.publicationStatus(publicationToken, recordId: publish.record.id, result: .publication(id: d, status: .revoked, messageId: nil)) == .refresh(selected))
        try state.deleted(scope, messageId: b); check(state.selection == nil)
        check(try journal.records().allSatisfy { $0.selection.visibleActorId == nil && !$0.selection.hints.delete && $0.publishedMessageId == nil })
        position.select(scope); let rt = position.capture()!; _ = try position.accept(rt, snapshot: ReadSnapshot(context: context, messageIds: []))
        let lateRead = try position.displayed(rt, messageId: b)!; position.select(nil); position.select(scope)
        rejects { try lateRead.claim() }; check(try !position.finish(lateRead, acknowledged: true, savedMessageId: b))
        rejects { _ = try MessageReadWire.saved(data("{\"messageId\":null,\"extra\":1}")) }
        check(!actionID(a + "\n")); check(!MessageReadWire.validContext(context + "\n"))
        print("MessageActionChecks: \(checks) checks passed (contract/state/disk-journal reconstruction/viewport)")
    }
}
