import Foundation
import GRDB

extension RoomsDatabase {
    func commands(scope: ConversationScope, db: Database) throws -> [StoredTextCommand] {
        try Row.fetchAll(db, sql: "SELECT * FROM text_commands WHERE room=? AND membership=? AND phase<>'settled' ORDER BY ordinal", arguments: [scope.room.id, scope.room.membershipScope]).map { row in
            guard let phase = TextCommandPhase(rawValue: row["phase"]) else { throw ConversationError.persistence }
            let data: Data? = row["payload"]; let rawVersion: String? = row["version"]
            let command = try data.map { try JSONDecoder().decode(TextCommand.self, from: $0) }
            let id: String = row["id"]; let membership: String = row["membership"]; let messageID: String? = row["message"]
            guard RoomsWire.uuid(id), RoomsWire.token(membership), messageID.map(RoomsWire.uuid) ?? true,
                  command == nil || (command?.id == id && command?.membershipScope == membership && command?.roomID == scope.room.id),
                  ![.deleted, .blocked].contains(phase) || command == nil else { throw ConversationError.persistence }
            return StoredTextCommand(id: id, phase: phase, command: command, messageID: messageID, version: try rawVersion.map(MessageVersion.init))
        }
    }
    public func admitText(_ command: TextCommand, scope: ConversationScope) throws {
        try write(conversation: scope) { db in
            guard command.roomID == scope.room.id, command.membershipScope == scope.room.membershipScope,
                  try Bool.fetchOne(db, sql: "SELECT ready FROM conversation WHERE room=?", arguments: [scope.room.id]) == true else { throw ConversationError.staleScope }
            if scope.room.mode == "FAN" {
                if scope.room.role == "FAN" {
                    guard command.intent == "ROOM_OWNER" else { throw ConversationError.forbidden }
                } else if scope.room.role == "STREAMER" {
                    guard command.intent == "SHARED" || (command.intent == "PRIVATE" && command.quoteID != nil) else { throw ConversationError.forbidden }
                } else { throw ConversationError.forbidden }
            } else {
                guard command.intent != "ROOM_OWNER", command.intent != "PRIVATE" || command.quoteID != nil else { throw ConversationError.forbidden }
            }
            if let quote = command.quoteID {
                guard command.intent == "PRIVATE", let data = try Data.fetchOne(db, sql: "SELECT value FROM timeline WHERE room=? AND id=? AND deleted=0", arguments: [scope.room.id, quote]) else { throw ConversationError.forbidden }
                let message = try JSONDecoder().decode(ConversationMessage.self, from: data)
                guard message.allowedActions.reply, let recipient = message.replyRecipient,
                      recipient == command.recipientActorID, recipient != scope.room.actorId else { throw ConversationError.forbidden }
            }
            guard try Int.fetchOne(db, sql: "SELECT COUNT(*) FROM text_commands WHERE phase IN ('queued','sending','unknown')")! < 100 else { throw ConversationError.busy }
            let last = try Int64.fetchOne(db, sql: "SELECT COALESCE(MAX(ordinal),0) FROM text_commands")!
            guard last < Int64.max else { throw ConversationError.persistence }
            try db.execute(sql: "INSERT INTO text_commands(room,id,membership,phase,payload,ordinal) VALUES (?,?,?,'queued',?,?)", arguments: [scope.room.id, command.id, command.membershipScope, try JSONEncoder().encode(command), last + 1])
        }
    }
    public func claimText(_ command: TextCommand, scope: ConversationScope) throws {
        try write(conversation: scope) { db in
            guard command.membershipScope == scope.room.membershipScope,
                  let row = try Row.fetchOne(db, sql: "SELECT phase,payload FROM text_commands WHERE room=? AND id=?", arguments: [scope.room.id, command.id]),
                  row["phase"] as String == "queued", let data: Data = row["payload"],
                  try JSONDecoder().decode(TextCommand.self, from: data) == command else { throw ConversationError.staleScope }
            try db.execute(sql: "UPDATE text_commands SET phase='sending' WHERE room=? AND id=?", arguments: [scope.room.id, command.id])
        }
    }
    public func markTextUnknown(id: String, scope: ConversationScope) throws {
        try write(conversation: scope) { db in
            try db.execute(sql: "UPDATE text_commands SET phase='unknown' WHERE room=? AND id=? AND phase IN ('queued','sending')", arguments: [scope.room.id, id])
        }
    }
    public func markTextRejected(id: String, blocked: Bool, scope: ConversationScope) throws {
        try write(conversation: scope) { db in
            if blocked {
                try db.execute(sql: "UPDATE text_commands SET phase='blocked',payload=NULL WHERE room=? AND id=? AND phase IN ('queued','sending','unknown')", arguments: [scope.room.id, id])
            } else {
                try db.execute(sql: "UPDATE text_commands SET phase='rejected' WHERE room=? AND id=? AND phase IN ('queued','sending')", arguments: [scope.room.id, id])
            }
        }
    }
    public func recordSendReceipt(_ receipt: SendReceipt, expected: TextCommand, scope: ConversationScope) throws {
        guard receipt.commandID == expected.id else { throw ConversationError.invalidResponse }
        switch receipt {
        case .committed(let id, let message, let version): try recordReceipt(id: id, message: message, version: version, deleted: false, scope: scope)
        case .deleted(let id, let message): try recordReceipt(id: id, message: message, version: nil, deleted: true, scope: scope)
        }
    }
    public func recordCommandReceipt(_ receipt: CommandReceipt, expectedID: String, scope: ConversationScope) throws {
        guard receipt.commandID == expectedID else { throw ConversationError.invalidResponse }
        switch receipt {
        case .committed(let id, let message, let version): try recordReceipt(id: id, message: message, version: version, deleted: false, scope: scope)
        case .deleted(let id): try recordReceipt(id: id, message: nil, version: nil, deleted: true, scope: scope)
        }
    }
    private func recordReceipt(id: String, message: String?, version: MessageVersion?, deleted: Bool, scope: ConversationScope) throws {
        try write(conversation: scope) { db in
            guard let row = try Row.fetchOne(db, sql: "SELECT membership,phase,message,version FROM text_commands WHERE room=? AND id=?", arguments: [scope.room.id, id]),
                  row["membership"] as String == scope.room.membershipScope else { throw ConversationError.staleScope }
            let oldPhase: String = row["phase"]; let oldMessage: String? = row["message"]
            if oldPhase == "deleted" || oldPhase == "blocked" || oldPhase == "settled" { return }
            guard oldMessage == nil || message == nil || oldMessage == message else { throw ConversationError.invalidResponse }
            let resolvedMessage = message ?? oldMessage
            if deleted {
                try db.execute(sql: "UPDATE text_commands SET phase='deleted',payload=NULL,message=?,version=NULL WHERE room=? AND id=?", arguments: [resolvedMessage, scope.room.id, id])
                if let resolvedMessage {
                    let existing = try Row.fetchOne(db, sql: "SELECT version,createdAt FROM timeline WHERE room=? AND id=?", arguments: [scope.room.id, resolvedMessage])
                    let terminalVersion: String = existing?["version"] ?? "1"; let createdAt: String? = existing?["createdAt"]
                    try db.execute(sql: "INSERT OR REPLACE INTO timeline(room,id,version,createdAt,deleted,value) VALUES(?,?,?,?,1,NULL)", arguments: [scope.room.id, resolvedMessage, terminalVersion, createdAt])
                }
            } else {
                guard let message, let version else { throw ConversationError.invalidResponse }
                // A known message tombstone also dominates late committed receipts.
                if try Bool.fetchOne(db, sql: "SELECT deleted FROM timeline WHERE room=? AND id=?", arguments: [scope.room.id, message]) == true {
                    try db.execute(sql: "UPDATE text_commands SET phase='deleted',payload=NULL,message=?,version=NULL WHERE room=? AND id=?", arguments: [message, scope.room.id, id])
                } else {
                    let oldVersion: String? = row["version"]
                    let latest = try oldVersion.map(MessageVersion.init).map { max($0, version) } ?? version
                    try db.execute(sql: "UPDATE text_commands SET phase='committed',message=?,version=? WHERE room=? AND id=?", arguments: [message, latest.rawValue, scope.room.id, id])
                    if let data = try Data.fetchOne(db, sql: "SELECT value FROM timeline WHERE room=? AND id=? AND deleted=0 AND hidden=0", arguments: [scope.room.id, message]) {
                        try retireProjectedCommands(JSONDecoder().decode(ConversationMessage.self, from: data), room: scope.room.id, db: db)
                    }
                }
            }
        }
    }
    // Retire only the exact receipt mapping and actual authorized projection in this transaction.
    func retireProjectedCommands(_ message: ConversationMessage, room: String, db: Database) throws {
        for row in try Row.fetchAll(db, sql: "SELECT id,version FROM text_commands WHERE room=? AND message=? AND phase='committed'", arguments: [room, message.id]) {
            guard let version: String = row["version"], try MessageVersion(version) <= message.version else { continue }
            try db.execute(sql: "UPDATE text_commands SET phase='settled',payload=NULL WHERE room=? AND id=?", arguments: [room, row["id"] as String])
        }
    }
    public func containsText(_ id: String, scope: ConversationScope) throws -> Bool {
        try write(conversation: scope) { db in
            try Bool.fetchOne(db, sql: "SELECT EXISTS(SELECT 1 FROM text_commands WHERE room=? AND membership=? AND id=?)", arguments: [scope.room.id, scope.room.membershipScope, id])!
        }
    }
    public func applySingleMessage(_ message: ConversationMessage, scope: ConversationScope) throws {
        try write(conversation: scope) { db in try putMessage(message, room: scope.room.id, db: db) }
    }
}
