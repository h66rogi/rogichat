import Foundation
import GRDB

extension RoomsDatabase {
    func verifyConversation(_ db: Database, _ conversation: ConversationScope) throws {
        guard conversation.account === scope, try Bool.fetchOne(db, sql: "SELECT confirmed FROM metadata") == true,
              let row = try Row.fetchOne(db, sql: "SELECT * FROM conversation WHERE room=?", arguments: [conversation.room.id]),
              row["cache"] as String == conversation.cacheID, row["profileCache"] as String == conversation.profileCacheID,
              row["membership"] as String == conversation.room.membershipScope, row["authority"] as String == conversation.room.authorizationRevision,
              row["cycle"] as String == conversation.directoryCycle,
              try String.fetchOne(db, sql: "SELECT run FROM manifest WHERE complete=1") == conversation.directoryCycle,
              let data = try Data.fetchOne(db, sql: "SELECT value FROM memberships WHERE id=?", arguments: [conversation.room.id]),
              try JSONDecoder().decode(MembershipRoom.self, from: data) == conversation.room else { throw ConversationError.staleScope }
    }
    public func beginConversation(roomID: String, cycle: String) throws -> ConversationScope {
        try write { db in
            guard RoomsWire.uuid(roomID), try Bool.fetchOne(db, sql: "SELECT confirmed FROM metadata") == true,
                  try String.fetchOne(db, sql: "SELECT run FROM manifest WHERE complete=1") == cycle,
                  let data = try Data.fetchOne(db, sql: "SELECT value FROM memberships WHERE id=?", arguments: [roomID]) else { throw ConversationError.staleScope }
            let room = try JSONDecoder().decode(MembershipRoom.self, from: data)
            let context = ConversationScope(account: scope, room: room, deviceID: deviceID, cycle: cycle)
            try db.execute(sql: "INSERT OR REPLACE INTO conversation(room,cache,profileCache,membership,authority,cycle) VALUES (?,?,?,?,?,?)", arguments: [roomID, context.cacheID, context.profileCacheID, room.membershipScope, room.authorizationRevision, cycle])
            for table in ["timeline", "conversation_profiles", "profile_staging", "conversation_cursors"] { try db.execute(sql: "DELETE FROM \(table) WHERE room=?", arguments: [roomID]) }
            // Cold or interrupted work is reconciled by GET only, never replayed.
            try db.execute(sql: "UPDATE text_commands SET phase='unknown' WHERE room=? AND phase IN ('queued','sending')", arguments: [roomID])
            try db.execute(sql: "DELETE FROM text_commands WHERE room=? AND membership<>?", arguments: [roomID, room.membershipScope])
            return context
        }
    }
    func reconcileConversationAuthority(_ db: Database) throws {
        let members = try Data.fetchAll(db, sql: "SELECT value FROM memberships").map { try JSONDecoder().decode(MembershipRoom.self, from: $0) }
        let current = Dictionary(uniqueKeysWithValues: members.map { ($0.id, $0) })
        try db.execute(sql: "DELETE FROM text_commands WHERE room NOT IN (SELECT id FROM memberships)")
        for member in members {
            try db.execute(sql: "DELETE FROM text_commands WHERE room=? AND membership<>?", arguments: [member.id, member.membershipScope])
        }
        for row in try Row.fetchAll(db, sql: "SELECT room,membership,authority FROM conversation") {
            let room: String = row["room"]
            let member = current[room]
            if member?.membershipScope != row["membership"] as String || member?.authorizationRevision != row["authority"] as String {
                for table in ["conversation", "timeline", "conversation_profiles", "profile_staging", "conversation_cursors"] {
                    try db.execute(sql: "DELETE FROM \(table) WHERE room=?", arguments: [room])
                }
                // Drop confirmed/rejected display payloads; an unacknowledged original intent
                // in the same M survives A-only churn for receipt-only recovery.
                try db.execute(sql: "UPDATE text_commands SET payload=NULL WHERE room=? AND phase IN ('committed','settled','rejected')", arguments: [room])
            }
        }
    }
    private func matches(_ conversation: ConversationScope, membership: String?, authority: String?) throws {
        guard membership == conversation.room.membershipScope, authority == conversation.room.authorizationRevision else { throw ConversationError.membershipChanged }
    }
    func putMessage(_ message: ConversationMessage, room: String, db: Database) throws {
        if let row = try Row.fetchOne(db, sql: "SELECT version,createdAt,deleted FROM timeline WHERE room=? AND id=?", arguments: [room, message.id]) {
            let createdAt: String? = row["createdAt"]
            guard createdAt == nil || createdAt == message.createdAt else { throw ConversationError.invalidResponse }
            let old = try MessageVersion(row["version"])
            if row["deleted"] as Bool || old > message.version { return }
        }
        // Whole C05 projection replacement also at equal message version.
        try db.execute(sql: "INSERT OR REPLACE INTO timeline(room,id,version,createdAt,deleted,value) VALUES(?,?,?,?,0,?)", arguments: [room, message.id, message.version.rawValue, message.createdAt, try JSONEncoder().encode(message)])
        try retireProjectedCommands(message, room: room, db: db)
    }
    private func tombstone(id: String, version: MessageVersion, room: String, db: Database) throws {
        let row = try Row.fetchOne(db, sql: "SELECT version,createdAt FROM timeline WHERE room=? AND id=?", arguments: [room, id])
        if let row, try MessageVersion(row["version"]) > version { return }
        let createdAt: String? = row?["createdAt"]
        try db.execute(sql: "INSERT OR REPLACE INTO timeline(room,id,version,createdAt,deleted,value) VALUES(?,?,?,?,1,NULL)", arguments: [room, id, version.rawValue, createdAt])
        try db.execute(sql: "UPDATE text_commands SET phase='deleted',payload=NULL,version=NULL WHERE room=? AND message=?", arguments: [room, id])
    }
    public func applySnapshot(_ page: ConversationSnapshot, scope: ConversationScope) throws {
        try write(conversation: scope) { db in
            try matches(scope, membership: page.membershipScope, authority: page.authorizationRevision)
            guard try Bool.fetchOne(db, sql: "SELECT ready FROM conversation WHERE room=?", arguments: [scope.room.id]) == false else { throw ConversationError.staleScope }
            for message in page.messages { try putMessage(message, room: scope.room.id, db: db) }
            try db.execute(sql: "UPDATE conversation SET ready=1,eventCursor=?,historyCursor=? WHERE room=?", arguments: [page.nextCursor, page.historyCursor, scope.room.id])
        }
    }
    public func applyEvents(_ page: ConversationEvents, requestedCursor: String, scope: ConversationScope) throws {
        guard !page.resetRequired else { throw ConversationError.membershipChanged }
        try write(conversation: scope) { db in
            try matches(scope, membership: page.membershipScope, authority: page.authorizationRevision)
            guard try String.fetchOne(db, sql: "SELECT eventCursor FROM conversation WHERE room=? AND ready=1", arguments: [scope.room.id]) == requestedCursor else { throw ConversationError.staleScope }
            if page.hasMore, page.nextCursor == requestedCursor { throw ConversationError.invalidResponse }
            for event in page.events {
                switch event {
                case .upsert(let message): try putMessage(message, room: scope.room.id, db: db)
                case .deleted(let id, let version): try tombstone(id: id, version: version, room: scope.room.id, db: db)
                }
            }
            try db.execute(sql: "UPDATE conversation SET eventCursor=? WHERE room=?", arguments: [page.nextCursor, scope.room.id])
        }
    }
    public func applyHistory(_ page: ConversationHistory, requestedCursor: String, scope: ConversationScope) throws {
        guard !page.resetRequired else { throw ConversationError.membershipChanged }
        try write(conversation: scope) { db in
            try matches(scope, membership: page.membershipScope, authority: page.authorizationRevision)
            guard try String.fetchOne(db, sql: "SELECT historyCursor FROM conversation WHERE room=? AND ready=1", arguments: [scope.room.id]) == requestedCursor else { throw ConversationError.staleScope }
            try visit(page.nextCursor, requested: requestedCursor, kind: "history", room: scope.room.id, db: db)
            for message in page.messages { try putMessage(message, room: scope.room.id, db: db) }
            try db.execute(sql: "UPDATE conversation SET historyCursor=? WHERE room=?", arguments: [page.nextCursor, scope.room.id])
        }
    }
    private func visit(_ next: String?, requested: String?, kind: String, room: String, db: Database) throws {
        if let next {
            guard next != requested, try Bool.fetchOne(db, sql: "SELECT EXISTS(SELECT 1 FROM conversation_cursors WHERE room=? AND kind=? AND value=?)", arguments: [room, kind, next]) == false else { throw ConversationError.invalidResponse }
            try db.execute(sql: "INSERT INTO conversation_cursors(room,kind,value) VALUES (?,?,?)", arguments: [room, kind, next])
        }
    }
    public func beginProfiles(scope: ConversationScope) throws {
        try write(conversation: scope) { db in
            try db.execute(sql: "UPDATE conversation SET profileGeneration=NULL,profileNext=NULL,profileComplete=0 WHERE room=?", arguments: [scope.room.id])
            try db.execute(sql: "DELETE FROM profile_staging WHERE room=?", arguments: [scope.room.id])
            try db.execute(sql: "DELETE FROM conversation_cursors WHERE room=? AND kind='profiles'", arguments: [scope.room.id])
        }
    }
    public func hideProjection(messageID: String, scope: ConversationScope) throws {
        try write(conversation: scope) { db in
            // Inaccessibility is not a deletion. Wipe private DTO fields without a terminal tombstone.
            try db.execute(sql: "UPDATE timeline SET hidden=1,value=NULL WHERE room=? AND id=? AND deleted=0", arguments: [scope.room.id, messageID])
            try db.execute(sql: "UPDATE text_commands SET payload=NULL WHERE room=? AND message=? AND phase IN ('committed','settled')", arguments: [scope.room.id, messageID])
        }
    }
    public func applyProfiles(_ page: ConversationProfiles, requestedCursor: String?, scope: ConversationScope) throws {
        guard !page.resetRequired else { throw ConversationError.membershipChanged }
        try write(conversation: scope) { db in
            try matches(scope, membership: page.membershipScope, authority: page.authorizationRevision)
            guard let row = try Row.fetchOne(db, sql: "SELECT profileGeneration,profileNext,profileComplete FROM conversation WHERE room=?", arguments: [scope.room.id]),
                  row["profileComplete"] as Bool == false, row["profileNext"] as String? == requestedCursor else { throw ConversationError.staleScope }
            let generation: String? = row["profileGeneration"]
            guard generation == nil || generation == page.generation else { throw ConversationError.invalidResponse }
            try visit(page.nextCursor, requested: requestedCursor, kind: "profiles", room: scope.room.id, db: db)
            for profile in page.profiles {
                guard try Bool.fetchOne(db, sql: "SELECT EXISTS(SELECT 1 FROM profile_staging WHERE room=? AND actor=?)", arguments: [scope.room.id, profile.id]) == false else { throw ConversationError.invalidResponse }
                try db.execute(sql: "INSERT INTO profile_staging(room,actor,value) VALUES (?,?,?)", arguments: [scope.room.id, profile.id, try JSONEncoder().encode(profile)])
            }
            guard try Int.fetchOne(db, sql: "SELECT COUNT(*) FROM profile_staging WHERE room=?", arguments: [scope.room.id])! <= 10_000 else { throw ConversationError.invalidResponse }
            if page.complete {
                try db.execute(sql: "DELETE FROM conversation_profiles WHERE room=?", arguments: [scope.room.id])
                try db.execute(sql: "INSERT INTO conversation_profiles SELECT * FROM profile_staging WHERE room=?", arguments: [scope.room.id])
                try db.execute(sql: "DELETE FROM profile_staging WHERE room=?", arguments: [scope.room.id])
            }
            try db.execute(sql: "UPDATE conversation SET profileGeneration=?,profileNext=?,profileComplete=? WHERE room=?", arguments: [page.generation, page.nextCursor, page.complete, scope.room.id])
        }
    }
    public func conversationListing(scope: ConversationScope) throws -> ConversationListing {
        try write(conversation: scope) { db in
            guard let row = try Row.fetchOne(db, sql: "SELECT ready,eventCursor,historyCursor,profileComplete,profileNext FROM conversation WHERE room=?", arguments: [scope.room.id]) else { throw ConversationError.staleScope }
            let ready: Bool = row["ready"]
            let messages = ready ? try Data.fetchAll(db, sql: "SELECT value FROM timeline WHERE room=? AND deleted=0 AND hidden=0 ORDER BY createdAt COLLATE BINARY,id COLLATE BINARY", arguments: [scope.room.id]).map { try JSONDecoder().decode(ConversationMessage.self, from: $0) } : []
            let profiles = try (row["profileComplete"] as Bool) ? Data.fetchAll(db, sql: "SELECT value FROM conversation_profiles WHERE room=? ORDER BY actor COLLATE BINARY", arguments: [scope.room.id]).map { try JSONDecoder().decode(ConversationProfile.self, from: $0) } : []
            return ConversationListing(messages: messages, commands: try commands(scope: scope, db: db), profiles: profiles, eventCursor: row["eventCursor"], historyCursor: row["historyCursor"], ready: ready, profilesComplete: row["profileComplete"], profileCursor: row["profileNext"])
        }
    }
}
