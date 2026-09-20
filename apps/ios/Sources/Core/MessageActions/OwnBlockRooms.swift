import Foundation
import Observation
#if canImport(RogichatRooms)
import RogichatRooms
#endif

// Current server projection is display-only. The durable journal keeps room IDs only.
struct BlockRoomReference: Codable, Sendable { let id: String }
struct OwnBlockRoom: Identifiable, Equatable, Sendable {
    let id: String
    let displayName: String?
    var label: String { displayName.flatMap { $0.isEmpty ? nil : $0 } ?? "이름을 확인할 수 없는 대화방" }
}
struct OwnBlockRoomsPage: Sendable { let rooms: [OwnBlockRoom]; let next: String? }
enum OwnBlockRoomsWire {
    static func cursor(_ value: String) -> Bool {
        !value.isEmpty && value.utf8.count <= 2200 && !value.unicodeScalars.contains { CharacterSet.whitespacesAndNewlines.union(.controlCharacters).contains($0) }
    }
    static func page(_ data: Data) throws -> OwnBlockRoomsPage {
        let object = try ActionJSON.object(data)
        guard Set(object.keys) == ["rooms", "nextCursor"], let rows = object["rooms"] as? [[String: Any]], rows.count <= 50 else { throw MessageActionError.invalidResponse }
        let rooms = try rows.map { row -> OwnBlockRoom in
            guard Set(row.keys) == ["roomId", "displayName"], let id = row["roomId"] as? String, actionID(id),
                  row["displayName"] is NSNull || row["displayName"] is String else { throw MessageActionError.invalidResponse }
            return OwnBlockRoom(id: id, displayName: row["displayName"] as? String)
        }
        guard Set(rooms.map(\.id)).count == rooms.count, object["nextCursor"] is NSNull || (object["nextCursor"] as? String).map(cursor) == true else { throw MessageActionError.invalidResponse }
        return OwnBlockRoomsPage(rooms: rooms, next: object["nextCursor"] as? String)
    }
}
@MainActor @Observable final class OwnBlockRoomsModel {
    private let fetch: @Sendable (String?) async throws -> Data
    private let scope: RoomsScope
    private var revision: UInt64 = 0
    private(set) var rooms: [OwnBlockRoom] = []
    private(set) var busy = false
    private(set) var complete = false
    private(set) var error: String?
    init(scope: RoomsScope, fetch: @escaping @Sendable (String?) async throws -> Data) { self.scope = scope; self.fetch = fetch }
    func refresh() async {
        guard !busy else { return }; revision &+= 1; let ticket = revision
        busy = true; complete = false; rooms = []; error = nil
        defer { if ticket == revision { busy = false } }
        do {
            var next: String?; var cursors = Set<String>(); var ids = Set<String>(); var accumulated: [OwnBlockRoom] = []
            var pages = 0
            repeat {
                try scope.check(); try Task.checkCancellation()
                let page = try OwnBlockRoomsWire.page(await fetch(next))
                try scope.check(); try Task.checkCancellation(); guard ticket == revision else { return }
                pages += 1
                guard pages <= 1000, accumulated.count + page.rooms.count <= 5000,
                      page.rooms.allSatisfy({ ids.insert($0.id).inserted }) else { throw MessageActionError.invalidResponse }
                accumulated += page.rooms; next = page.next
                if let next { guard cursors.insert(next).inserted else { throw MessageActionError.invalidResponse } }
                // An empty scan page is not completion. Only nextCursor=null completes it.
            } while next != nil
            rooms = accumulated; complete = true
        } catch {
            guard ticket == revision else { return }
            rooms = []; complete = false
            self.error = "현재 차단된 대화방 목록을 확인하지 못했어요. 처음부터 다시 확인해 주세요."
        }
    }
    func close() { revision &+= 1; rooms = []; complete = false; busy = false; error = nil }
}
