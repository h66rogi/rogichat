import Foundation
import GRDB

extension RoomsDatabase {
    public func featureRecords(_ kind: ConversationJournal, scope: ConversationScope) throws -> [Data] {
        try write(conversation: scope) { db in
            if kind == .moderation || kind == .blockRooms { return try Data.fetchAll(db, sql: "SELECT value FROM account_features WHERE kind=? AND room=? ORDER BY id", arguments: [kind.rawValue, scope.room.id]) }
            return try Data.fetchAll(db, sql: "SELECT value FROM conversation_features WHERE room=? AND membership=? AND kind=?" + (kind == .viewport ? " AND authority=?" : "") + " ORDER BY id", arguments: kind == .viewport ? [scope.room.id, scope.room.membershipScope, kind.rawValue, scope.room.authorizationRevision] : [scope.room.id, scope.room.membershipScope, kind.rawValue])
        }
    }
    public func putFeature(_ kind: ConversationJournal, id: String, value: Data, scope: ConversationScope) throws {
        guard RoomsWire.uuid(id), value.count <= 65536 else { throw ConversationError.persistence }
        try write(conversation: scope) { db in
            if kind == .moderation || kind == .blockRooms {
                try putAccountFeature(db, kind: kind.rawValue, room: scope.room.id, id: id, value: value); return
            }
            guard try Int.fetchOne(db, sql: "SELECT COUNT(*) FROM conversation_features WHERE room=? AND membership=? AND kind=? AND id<>?", arguments: [scope.room.id, scope.room.membershipScope, kind.rawValue, id])! < 500 else { throw ConversationError.persistence }
            try db.execute(sql: "INSERT OR REPLACE INTO conversation_features(room,membership,authority,kind,id,value) VALUES(?,?,?,?,?,?)", arguments: [scope.room.id, scope.room.membershipScope, scope.room.authorizationRevision, kind.rawValue, id, value])
        }
    }
    public func removeFeature(_ kind: ConversationJournal, id: String, scope: ConversationScope) throws {
        try write(conversation: scope) { db in try db.execute(sql: "DELETE FROM conversation_features WHERE room=? AND membership=? AND kind=? AND id=?", arguments: [scope.room.id, scope.room.membershipScope, kind.rawValue, id]) }
    }
    func hideQuotedCopies(_ id: String, room: String, db: Database) throws {
        for row in try Row.fetchAll(db, sql: "SELECT id,value FROM timeline WHERE room=? AND deleted=0 AND hidden=0", arguments: [room]) {
            let value: Data = row["value"]; let message = try JSONDecoder().decode(ConversationMessage.self, from: value)
            if message.quote?.id == id {
                try db.execute(sql: "UPDATE timeline SET hidden=1,value=NULL WHERE room=? AND id=?", arguments: [room, message.id])
                try db.execute(sql: "UPDATE text_commands SET payload=NULL WHERE room=? AND message=? AND phase IN ('committed','settled','rejected')", arguments: [room, message.id])
            }
        }
    }
    public func blockProjection(_ id: String, scope: ConversationScope) throws {
        try write(conversation: scope) { db in
            // Acknowledged access block is terminal in this authority cache generation.
            // Its quote copies are hidden until an authorized projection removes the quote.
            try db.execute(sql: "UPDATE timeline SET deleted=1,hidden=0,value=NULL WHERE room=? AND id=?", arguments: [scope.room.id, id])
            try db.execute(sql: "UPDATE text_commands SET payload=NULL WHERE room=? AND message=? AND phase IN ('committed','settled','rejected')", arguments: [scope.room.id, id])
            try hideQuotedCopies(id, room: scope.room.id, db: db)
        }
    }
}
private struct ScopedFeatureJournal: ConversationFeatureJournal {
    let database: RoomsDatabase
    let scope: ConversationScope
    func records(_ journal: ConversationJournal) throws -> [Data] { try database.featureRecords(journal, scope: scope) }
    func put(_ journal: ConversationJournal, id: String, value: Data) throws { try database.putFeature(journal, id: id, value: value, scope: scope) }
    func remove(_ journal: ConversationJournal, id: String) throws { try database.removeFeature(journal, id: id, scope: scope) }
}
extension RoomConversationCoordinator: ConversationFeatureStoring {
    public nonisolated var localFeatures: any ConversationFeatureJournal { ScopedFeatureJournal(database: database, scope: scope) }
    public func featureRecords(_ journal: ConversationJournal) throws -> [Data] { try database.featureRecords(journal, scope: scope) }
    public func putFeature(_ journal: ConversationJournal, id: String, value: Data) throws { try database.putFeature(journal, id: id, value: value, scope: scope) }
    public func removeFeature(_ journal: ConversationJournal, id: String) throws { try database.removeFeature(journal, id: id, scope: scope) }
    public func blockProjection(_ messageID: String) throws { try database.blockProjection(messageID, scope: scope) }
}

public enum AccountFeatureKind: String, Sendable { case moderation, unblocks, blockRooms, avatar }
extension RoomsDatabase {
    public func accountRecords(_ kind: AccountFeatureKind, room: String? = nil) throws -> [Data] {
        try write { db in
            try Data.fetchAll(db, sql: "SELECT value FROM account_features WHERE kind=?" + (room == nil ? "" : " AND room=?") + " ORDER BY room,id", arguments: room.map { [kind.rawValue, $0] } ?? [kind.rawValue])
        }
    }
    func putAccountFeature(_ db: Database, kind: String, room: String, id: String, value: Data) throws {
        guard RoomsWire.uuid(room), RoomsWire.uuid(id), value.count <= 65536,
              try Int.fetchOne(db, sql: "SELECT COUNT(*) FROM account_features WHERE kind=? AND (room<>? OR id<>?)", arguments: [kind, room, id])! < 500 else { throw RoomsError.persistence }
        try db.execute(sql: "INSERT OR REPLACE INTO account_features(kind,room,id,value) VALUES(?,?,?,?)", arguments: [kind, room, id, value])
    }
    public func putAccountFeature(_ kind: AccountFeatureKind, room: String, id: String, value: Data) throws {
        try write { db in try putAccountFeature(db, kind: kind.rawValue, room: room, id: id, value: value) }
    }
    public func removeAccountFeature(_ kind: AccountFeatureKind, room: String, id: String) throws {
        try write { db in try db.execute(sql: "DELETE FROM account_features WHERE kind=? AND room=? AND id=?", arguments: [kind.rawValue, room, id]) }
    }
}
