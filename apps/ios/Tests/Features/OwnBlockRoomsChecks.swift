import Foundation

#if ROGICHAT_SHARED_STATE_MODULE
@testable import RogichatNativeStateChecks
#endif

private actor BlockRoomsPages {
    var values: [Data]
    private(set) var cursors: [String?] = []
    init(_ values: [Data]) { self.values = values }
    func fetch(_ cursor: String?) throws -> Data { cursors.append(cursor); guard !values.isEmpty else { throw MessageActionError.invalidResponse }; return values.removeFirst() }
}
private actor OldBlockPage {
    private var call = 0
    private var pending: CheckedContinuation<Data, any Error>?
    private var waiter: CheckedContinuation<Void, Never>?
    func fetch() async throws -> Data {
        call += 1
        if call == 1 { return try await withCheckedThrowingContinuation { pending = $0; waiter?.resume(); waiter = nil } }
        return try OwnBlockRoomsChecks.page([["roomId":OwnBlockRoomsChecks.id,"displayName":"새로 확인된 이름"]])
    }
    func wait() async { if pending != nil { return }; await withCheckedContinuation { waiter = $0 } }
    func fail() { pending?.resume(throwing: MessageActionError.invalidResponse); pending = nil }
}
@main struct OwnBlockRoomsChecks {
    static func check(_ value: Bool) { precondition(value) }
    static let id = "00000000-0000-4000-8000-000000000001"
    static func scope() throws -> RoomsScope { try RoomsScope(partition:String(repeating:"A",count:43),clientScope:UUID(),expiresAt:Date().addingTimeInterval(300)) }
    static func page(_ rows: [[String:Any]], next: String? = nil) throws -> Data {
        try JSONSerialization.data(withJSONObject:["rooms":rows,"nextCursor":next as Any? ?? NSNull()])
    }
    @MainActor static func main() async throws {
        check(OwnBlockRoomsWire.cursor(String(repeating: "a", count: 2200)))
        check(!OwnBlockRoomsWire.cursor(String(repeating: "a", count: 2201)))
        let empty = try page([],next:"opaque-one")
        let visible = try page([["roomId":id,"displayName":"현재 허용된 이름"]])
        let source = BlockRoomsPages([empty,visible]); let model = OwnBlockRoomsModel(scope:try scope(),fetch:{try await source.fetch($0)})
        await model.refresh(); check(model.complete && model.rooms.first?.label == "현재 허용된 이름")
        check(await source.cursors == [nil,"opaque-one"])
        await model.refresh(); check(!model.complete && model.rooms.isEmpty && model.error != nil)
        for rows in [try page([["roomId":id,"displayName":NSNull()]]), visible] {
            let result = try OwnBlockRoomsWire.page(rows); check(result.rooms.count == 1)
        }
        for invalid in [
            Data(("{\"rooms\":[{\"roomId\":\"" + id + "\"}],\"nextCursor\":null}").utf8),
            Data("{\"rooms\":[],\"nextCursor\":null,\"nextCursor\":null}".utf8),
            try page([["roomId":id,"displayName":3]]),
            try page([["roomId":id,"displayName":NSNull()],["roomId":id,"displayName":NSNull()]])
        ] { do { _ = try OwnBlockRoomsWire.page(invalid); preconditionFailure("invalid projection accepted") } catch {} }
        let loop = BlockRoomsPages([empty,empty]); let loopModel = OwnBlockRoomsModel(scope:try scope(),fetch:{try await loop.fetch($0)})
        await loopModel.refresh(); check(!loopModel.complete && loopModel.rooms.isEmpty && loopModel.error != nil)
        let duplicate = BlockRoomsPages([try page([["roomId":id,"displayName":NSNull()]],next:"next"),visible])
        let duplicateModel = OwnBlockRoomsModel(scope:try scope(),fetch:{try await duplicate.fetch($0)})
        await duplicateModel.refresh(); check(!duplicateModel.complete && duplicateModel.rooms.isEmpty)
        let retired = try scope(); let gate = BlockRoomsPages([visible]); retired.invalidate()
        let retiredModel = OwnBlockRoomsModel(scope:retired,fetch:{try await gate.fetch($0)})
        await retiredModel.refresh(); check(await gate.cursors.isEmpty); check(retiredModel.rooms.isEmpty)
        let old = OldBlockPage(); let resumed = OwnBlockRoomsModel(scope:try scope(),fetch:{ _ in try await old.fetch() })
        let previous = Task { await resumed.refresh() }; await old.wait(); resumed.close(); await resumed.refresh()
        check(resumed.complete && resumed.rooms.first?.label == "새로 확인된 이름")
        await old.fail(); await previous.value
        check(resumed.complete && resumed.error == nil && resumed.rooms.first?.label == "새로 확인된 이름")
        print("Own block rooms current projection and pagination checks passed")
    }
}
