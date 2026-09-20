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
@MainActor final class TestBlockJournal: BlockJournal {
    var values: [UnblockRecord] = []
    func records() -> [UnblockRecord] { values }
    func put(_ record: UnblockRecord) { values.removeAll { $0.id == record.id }; values.append(record) }
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
        try FileManager.default.removeItem(at: journal.url); try state.select(selected)
        let uncertainReaction = try state.begin(state.capture()!, action: .setReaction, emoji: "👍")
        try uncertainReaction.claim(); _ = try state.finish(uncertainReaction, result: .unknown)
        check(try !state.blockedActions(state.capture()!).contains(.report))
        let independentReport = try state.begin(state.capture()!, action: .report, reportReason: .spam)
        try independentReport.claim(); _ = try state.finish(independentReport, result: .unknown)
        let independentBlock = try state.begin(state.capture()!, action: .blockActor)
        try independentBlock.claim(); _ = try state.finish(independentBlock, result: .unknown)
        check(try journal.records().count == 3 && journal.records().allSatisfy { $0.phase == .unknown })
        rejects { _ = try state.begin(state.capture()!, action: .removeReaction) }
        let blockJournal = TestBlockJournal(); let manager = ActorBlocksState(journal: blockJournal, actionJournal: journal)
        let blockScope = BlockScope(environment: "qa", accountId: a, sessionEpoch: b, roomId: c, viewEpoch: d)
        try manager.select(blockScope); let page = try manager.refresh()!
        check(try ActorBlocksWire.list(page).path == "rooms/\(c)/blocks")
        let rows = try ActorBlocksWire.page(data("{\"blocks\":[{\"actorId\":\"\(b)\",\"blockedAt\":\"2026-09-20T00:00:00.000Z\",\"displayName\":\"현재 이름 🌱\"}],\"next\":null}"))
        check(try manager.accept(page, page: rows) == BlockReset(scope: blockScope))
        check(try journal.records().last?.phase == .unknown && journal.records().last?.observedBlocked == true)
        let oldView = manager.capture()!; let unblock = try manager.unblock(oldView, actorId: b); try unblock.claim()
        check(unblock.request().method == "DELETE" && unblock.request().body == nil)
        check(ActorBlocksWire.result(unblock, status: 200, data: data("{\"actorId\":\"\(b)\",\"blocked\":false,\"resetRequired\":true}")) == .acknowledged)
        check(ActorBlocksWire.result(unblock, status: 200, data: data("{\"actorId\":\"\(d)\",\"blocked\":false,\"resetRequired\":true}")) == .unknown)
        _ = try manager.finish(unblock, outcome: .unknown)
        rejects { _ = try manager.unblock(oldView, actorId: b) }
        let recovery = try manager.refresh()!
        check(try manager.accept(recovery, page: BlockPage(blocks: [], next: nil)) == BlockReset(scope: blockScope))
        check(blockJournal.records().first?.outcome == .unknown && blockJournal.records().first?.observedBlocked == false)
        check(try journal.records().last?.phase == .unknown && journal.records().last?.observedBlocked == false)
        check(manager.complete && manager.blocks.isEmpty)
        let oldPage = try manager.refresh()!; try manager.select(nil); try manager.select(blockScope)
        check(try manager.accept(oldPage, page: rows) == nil)
        let newPage = try manager.refresh()!; _ = try manager.accept(newPage, page: rows)
        let lateUnblock = try manager.unblock(manager.capture()!, actorId: b); try manager.select(nil); try manager.select(blockScope)
        rejects { try lateUnblock.claim() }; check(try manager.finish(lateUnblock, outcome: .acknowledged) == nil)
        let id5 = "44444444-4444-5444-8444-444444444444"
        check(MessageActionWire.result(.delete, status: 200, data: data("{\"requestId\":\"\(id5)\",\"status\":\"blocked\"}")) == .deleted(id5))
        check(!actionID(id5))
        let staleList = try manager.refresh()!
        var oldBlock = try journal.records().first { $0.action == .blockActor }!
        oldBlock.phase = .actorBlocked; try journal.put(oldBlock)
        check(try manager.accept(staleList, page: rows) == nil && manager.failed && !manager.complete && manager.blocks.isEmpty)
        let partial = try manager.refresh()!
        check(try manager.accept(partial, page: BlockPage(blocks: rows.blocks, next: b)) == nil && !manager.complete)
        let continuation = manager.more()!
        check(try ActorBlocksWire.list(continuation).query == ["after": b] && !ActorBlocksWire.list(continuation).path.contains("?"))
        check(try manager.accept(continuation, page: BlockPage(blocks: [], next: nil)) == BlockReset(scope: blockScope))
        // Current GET labels are replaced wholesale, including explicit unavailability.
        let namedBody = "{\"blocks\":[{\"actorId\":\"\(b)\",\"blockedAt\":\"2026-09-20T00:00:00.000Z\",\"displayName\":\"현재 이름 🌱\"}],\"next\":null}"
        let unnamed = try ActorBlocksWire.page(data(namedBody.replacingOccurrences(of: "\"현재 이름 🌱\"", with: "null")))
        check(rows.blocks.first?.displayLabel == "현재 이름 🌱")
        check(unnamed.blocks.first?.displayName == nil && unnamed.blocks.first?.displayLabel == "이름을 확인할 수 없는 사용자")
        check(try ActorBlocksWire.page(data(namedBody.replacingOccurrences(of: "\"현재 이름 🌱\"", with: "\"\""))).blocks.first?.displayName == "")
        for invalid in ["42", "true", "false", "[]", "{}"] {
            rejects { _ = try ActorBlocksWire.page(data(namedBody.replacingOccurrences(of: "\"현재 이름 🌱\"", with: invalid))) }
        }
        rejects { _ = try ActorBlocksWire.page(data(namedBody.replacingOccurrences(of: ",\"displayName\":\"현재 이름 🌱\"", with: ""))) }
        rejects { _ = try ActorBlocksWire.page(data(namedBody.replacingOccurrences(of: "\"displayName\":", with: "\"userId\":"))) }
        rejects { _ = try ActorBlocksWire.page(data(namedBody.replacingOccurrences(of: "\"displayName\":", with: "\"displayName\":null,\"displayName\":"))) }
        check(manager.blocks.first?.displayLabel == "현재 이름 🌱")
        let superseded = try manager.refresh()!; check(manager.blocks.isEmpty)
        let latest = try manager.refresh()!
        check(try manager.accept(superseded, page: rows) == nil && manager.blocks.isEmpty)
        _ = try manager.accept(latest, page: unnamed)
        check(manager.blocks.first?.displayLabel == "이름을 확인할 수 없는 사용자")
        let failedRefresh = try manager.refresh()!; manager.fail(failedRefresh)
        check(manager.failed && manager.blocks.isEmpty)
        check(try manager.accept(failedRefresh, page: rows) == nil && manager.blocks.isEmpty)
        let renamed = try manager.refresh()!; _ = try manager.accept(renamed, page: rows)
        try manager.select(BlockScope(environment: "qa", accountId: a, sessionEpoch: b, roomId: c, viewEpoch: a))
        check(manager.blocks.isEmpty)
        try manager.select(blockScope)
        check(try manager.accept(renamed, page: rows) == nil && manager.blocks.isEmpty)
        try state.deleted(scope, messageId: b)
        check(try journal.records().first { $0.action == .report }?.phase == .unknown)
        print("MessageActionChecks: \(checks) checks passed (contract/state/disk-journal reconstruction/viewport)")
    }
}
