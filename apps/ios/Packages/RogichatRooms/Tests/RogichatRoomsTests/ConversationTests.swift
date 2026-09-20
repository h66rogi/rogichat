import Foundation
import Testing
import GRDB
@testable import RogichatRooms

private let cRoom = "00000000-0000-4000-8000-000000000001"
private let cActor = "00000000-0000-4000-8000-000000000002"
private let cPeer = "00000000-0000-4000-8000-000000000003"
private let cMessage = "00000000-0000-4000-8000-000000000004"
private func ct(_ byte: UInt8 = 1) -> String { Data(repeating: byte, count: 32).base64EncodedString().replacingOccurrences(of: "+", with: "-").replacingOccurrences(of: "/", with: "_").replacingOccurrences(of: "=", with: "") }
private func cd(_ object: [String: Any]) throws -> Data { try JSONSerialization.data(withJSONObject: object) }
private func decodeC<T: Decodable>(_ object: [String: Any], _ type: T.Type) throws -> T { try JSONDecoder().decode(type, from: cd(object)) }
private func cm(_ version: String = "1", reply: Bool = true, text: String = "실제 응답 형식") -> [String: Any] {
    ["id": cMessage, "version": version, "createdAt": "2026-09-20T01:02:03.004Z", "audience": "SHARED", "author": ["kind": "member", "actorId": cPeer, "nickname": "사용자", "avatar": NSNull()], "content": ["type": "TEXT", "text": text], "quote": NSNull(), "counterpart": NSNull(), "allowedActions": ["reply": reply, "publish": false, "delete": false]]
}
private func cs(_ messages: [[String: Any]] = [], authority: UInt8 = 2) throws -> Data { try cd(["schemaVersion": 2, "resetRequired": false, "membershipScope": ct(), "authorizationRevision": ct(authority), "messages": messages, "nextCursor": "events-0", "historyCursor": "history-0"]) }
private func ce(_ events: [[String: Any]] = [], next: String = "events-1") throws -> Data { try cd(["schemaVersion": 2, "resetRequired": false, "membershipScope": ct(), "authorizationRevision": ct(2), "events": events, "nextCursor": next, "hasMore": false]) }
private func cp(_ names: [String] = [], authority: UInt8 = 2) throws -> Data { try cd(["schemaVersion": 2, "resetRequired": false, "membershipScope": ct(), "authorizationRevision": ct(authority), "profiles": names.map { ["actorId": cPeer, "nickname": $0, "avatar": NSNull(), "role": "MEMBER"] as [String: Any] }, "generation": ct(3), "complete": true, "nextCursor": NSNull()]) }
private func manifestC(_ membership: String = ct(), authority: UInt8 = 2) throws -> MembershipPage { try decodeC(["schemaVersion": 2, "resetRequired": false, "rooms": [["roomId": cRoom, "name": "대화", "mode": "GROUP", "actorId": cActor, "role": "MEMBER", "membershipScope": membership, "authorizationRevision": ct(authority)]], "generation": ct(3), "complete": true, "nextCursor": NSNull()], MembershipPage.self) }
private final class ConversationDisk {
    let directory: URL
    let account: RoomsScope
    let db: RoomsDatabase
    let scope: ConversationScope
    init(path: URL? = nil, membership: String = ct()) throws {
        directory = path ?? FileManager.default.temporaryDirectory.appendingPathComponent("conversation-\(UUID().uuidString)")
        try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
        account = try RoomsScope(partition: ct(8), clientScope: UUID(), expiresAt: Date().addingTimeInterval(3600))
        db = try RoomsDatabase(url: directory.appendingPathComponent("rooms.sqlite"), scope: account, deviceID: cRoom)
        let request = try db.beginManifest(); _ = try db.manifestPage(manifestC(membership), request: request)
        scope = try db.beginConversation(roomID: cRoom, cycle: try #require(db.listing().cycle))
    }
    func snapshot(_ messages: [[String: Any]] = []) throws { try db.applySnapshot(JSONDecoder().decode(ConversationSnapshot.self, from: cs(messages)), scope: scope) }
    func close() throws { account.invalidate(); try db.close() }
    func remove() { try? close(); try? FileManager.default.removeItem(at: directory) }
}
@Test func conversationStrictDTOAndLosslessOrdering() throws {
    #expect(try MessageVersion("9007199254740993") < MessageVersion("18446744073709551615"))
    for invalid in ["0", "01", "1\n", "18446744073709551616"] { #expect(throws: (any Error).self) { try MessageVersion(invalid) } }
    var wire = cm(); let message = try decodeC(wire, ConversationMessage.self)
    #expect(message.replyRecipient == cPeer)
    #expect(try JSONDecoder().decode(ConversationMessage.self, from: JSONEncoder().encode(message)) == message)
    wire.removeValue(forKey: "counterpart"); #expect(throws: (any Error).self) { try decodeC(wire, ConversationMessage.self) }
    wire = cm(); wire["createdAt"] = "2026-02-30T01:02:03.004Z"; #expect(throws: (any Error).self) { try decodeC(wire, ConversationMessage.self) }
    wire = cm(); wire["author"] = ["kind": "anonymous"]; #expect(throws: (any Error).self) { try decodeC(wire, ConversationMessage.self) }
    wire = cm(reply: false); wire["author"] = ["kind": "anonymous"]
    #expect(try decodeC(wire, ConversationMessage.self).replyRecipient == nil)
    wire["author"] = ["kind": "anonymous", "actorId": cPeer]
    #expect(throws: (any Error).self) { try decodeC(wire, ConversationMessage.self) }
    #expect(try ConversationWire.normalizedText(" e\u{301} ") == " é ")
    for invalid in ["\u{FEFF}", "\0x", String(repeating: "가", count: 4001)] { #expect(throws: (any Error).self) { try ConversationWire.normalizedText(invalid) } }
    let command = try TextCommand(roomID: cRoom, membershipScope: ct(), text: "안녕")
    let body = try #require(JSONSerialization.jsonObject(with: command.requestBody()) as? [String: Any])
    #expect(body["recipientActorId"] == nil && body["membershipScope"] as? String == ct())
    let deleted: [String: Any] = ["clientMessageId": command.id, "status": "deleted"]
    #expect(try decodeC(deleted, CommandReceipt.self).commandID == command.id)
    #expect(throws: (any Error).self) { try decodeC(deleted, SendReceipt.self) }
    var sent = deleted; sent["messageId"] = cMessage
    #expect(try decodeC(sent, SendReceipt.self).commandID == command.id)
    #expect(throws: (any Error).self) { try decodeC(sent, CommandReceipt.self) }
}
@Test func conversationAtomicCursorTerminalTombstoneAndEqualProjection() throws {
    let disk = try ConversationDisk(); defer { disk.remove() }; try disk.snapshot([cm("9007199254740993")])
    try disk.db.applySingleMessage(decodeC(cm("9007199254740993", reply: false), ConversationMessage.self), scope: disk.scope)
    #expect(try disk.db.conversationListing(scope: disk.scope).messages[0].replyRecipient == nil)
    var changedTime = cm("9007199254740994"); changedTime["createdAt"] = "2026-09-20T01:02:03.005Z"
    let badEvents = try JSONDecoder().decode(ConversationEvents.self, from: ce([["type": "message.upsert", "message": changedTime]]))
    #expect(throws: ConversationError.invalidResponse) { try disk.db.applyEvents(badEvents, requestedCursor: "events-0", scope: disk.scope) }
    #expect(try disk.db.conversationListing(scope: disk.scope).eventCursor == "events-0")
    let deleted = try JSONDecoder().decode(ConversationEvents.self, from: ce([["type": "message.deleted", "messageId": cMessage, "version": "9007199254740994"]]))
    try disk.db.applyEvents(deleted, requestedCursor: "events-0", scope: disk.scope)
    try disk.db.applySingleMessage(decodeC(cm("18446744073709551615"), ConversationMessage.self), scope: disk.scope)
    #expect(try disk.db.conversationListing(scope: disk.scope).messages.isEmpty)
    #expect(throws: ConversationError.staleScope) { try disk.db.applyEvents(deleted, requestedCursor: "events-0", scope: disk.scope) }
    disk.scope.invalidate()
    #expect(throws: (any Error).self) { try disk.db.applySingleMessage(decodeC(cm(), ConversationMessage.self), scope: disk.scope) }
    let newScope = try disk.db.beginConversation(roomID: cRoom, cycle: #require(disk.db.listing().cycle))
    #expect(newScope.cacheID != disk.scope.cacheID)
    try disk.db.applySnapshot(JSONDecoder().decode(ConversationSnapshot.self, from: cs([cm()])), scope: newScope)
    #expect(try disk.db.conversationListing(scope: newScope).messages.count == 1)
}
@Test func conversationProfilesReplaceAndHistoryRollback() throws {
    let disk = try ConversationDisk(); defer { disk.remove() }; try disk.snapshot()
    try disk.db.beginProfiles(scope: disk.scope)
    try disk.db.applyProfiles(JSONDecoder().decode(ConversationProfiles.self, from: cp(["이전 이름"])), requestedCursor: nil, scope: disk.scope)
    #expect(try disk.db.conversationListing(scope: disk.scope).profiles.count == 1)
    try disk.db.beginProfiles(scope: disk.scope)
    #expect(try disk.db.conversationListing(scope: disk.scope).profiles.isEmpty)
    try disk.db.applyProfiles(JSONDecoder().decode(ConversationProfiles.self, from: cp()), requestedCursor: nil, scope: disk.scope)
    #expect(try disk.db.conversationListing(scope: disk.scope).profiles.isEmpty)
    let history = try decodeC(["schemaVersion": 2, "resetRequired": false, "membershipScope": ct(), "authorizationRevision": ct(2), "messages": [cm()], "nextCursor": "history-0"], ConversationHistory.self)
    #expect(throws: ConversationError.invalidResponse) { try disk.db.applyHistory(history, requestedCursor: "history-0", scope: disk.scope) }
    #expect(try disk.db.conversationListing(scope: disk.scope).messages.isEmpty)
}
@Test func conversationPrivateQuoteUsesCurrentActionsAndGroupTarget() throws {
    let disk = try ConversationDisk(); defer { disk.remove() }; try disk.snapshot([cm()])
    let reply = try TextCommand(roomID: cRoom, membershipScope: ct(), recipientActorID: cPeer, quoteID: cMessage, text: "비공개 답장")
    try disk.db.admitText(reply, scope: disk.scope)
    #expect(try disk.db.conversationListing(scope: disk.scope).commands.count == 1)
    try disk.db.applySingleMessage(decodeC(cm(reply: false), ConversationMessage.self), scope: disk.scope)
    let stale = try TextCommand(roomID: cRoom, membershipScope: ct(), recipientActorID: cPeer, quoteID: cMessage, text: "권한 변경 후")
    #expect(throws: ConversationError.forbidden) { try disk.db.admitText(stale, scope: disk.scope) }
    let nilEquality = try TextCommand(roomID: cRoom, membershipScope: ct(), quoteID: cMessage, text: "전체 인용")
    #expect(throws: ConversationError.forbidden) { try disk.db.admitText(nilEquality, scope: disk.scope) }
}
@Test func conversationDurableColdIntentNoRebindAndDeletedReceipt() throws {
    let original = try ConversationDisk(); let path = original.directory; defer { try? FileManager.default.removeItem(at: path) }
    try original.snapshot()
    let command = try TextCommand(roomID: cRoom, membershipScope: ct(), text: "보존되는 원본")
    try original.db.admitText(command, scope: original.scope); try original.db.claimText(command, scope: original.scope)
    try original.close()
    let cold = try ConversationDisk(path: path); defer { try? cold.close() }; try cold.snapshot()
    let persisted = try #require(cold.db.conversationListing(scope: cold.scope).commands.first)
    #expect(persisted.phase == .unknown && persisted.command == command)
    try cold.db.recordCommandReceipt(.committed(commandID: command.id, messageID: cMessage, version: MessageVersion("10")), expectedID: command.id, scope: cold.scope)
    try cold.db.recordCommandReceipt(.committed(commandID: command.id, messageID: cMessage, version: MessageVersion("9")), expectedID: command.id, scope: cold.scope)
    #expect(try cold.db.conversationListing(scope: cold.scope).commands[0].version?.rawValue == "10")
    try cold.db.recordCommandReceipt(.deleted(commandID: command.id), expectedID: command.id, scope: cold.scope)
    try cold.db.recordCommandReceipt(.committed(commandID: command.id, messageID: cMessage, version: MessageVersion("11")), expectedID: command.id, scope: cold.scope)
    let terminal = try cold.db.conversationListing(scope: cold.scope).commands[0]
    #expect(terminal.phase == .deleted && terminal.command == nil)
    try cold.db.applySingleMessage(decodeC(cm("18446744073709551615"), ConversationMessage.self), scope: cold.scope)
    #expect(try cold.db.conversationListing(scope: cold.scope).messages.isEmpty)
    let pending = try TextCommand(roomID: cRoom, membershipScope: ct(), text: "재입장 시 재전송 금지")
    try cold.db.admitText(pending, scope: cold.scope)
    let rejected = try TextCommand(roomID: cRoom, membershipScope: ct(), text: "거절된 이전 본문")
    try cold.db.admitText(rejected, scope: cold.scope); try cold.db.markTextRejected(id: rejected.id, blocked: false, scope: cold.scope)
    let committed = try TextCommand(roomID: cRoom, membershipScope: ct(), text: "저장된 이전 본문")
    try cold.db.admitText(committed, scope: cold.scope)
    try cold.db.recordCommandReceipt(.committed(commandID: committed.id, messageID: cPeer, version: MessageVersion("1")), expectedID: committed.id, scope: cold.scope)
    try cold.db.hideProjection(messageID: cPeer, scope: cold.scope)
    #expect(try cold.db.conversationListing(scope: cold.scope).commands.first(where: { $0.id == committed.id })?.command == nil)
    try cold.close()
    let rejoined = try ConversationDisk(path: path, membership: ct(9)); defer { try? rejoined.close() }
    #expect(try rejoined.db.conversationListing(scope: rejoined.scope).commands.isEmpty)
    #expect(try rejoined.db.write { try Int.fetchOne($0, sql: "SELECT COUNT(*) FROM text_commands") } == 0)
}

private actor ConversationRemote: ConversationFetching {
    var receipt: Data?
    var profile = try! cp(["처음"])
    var message = try! cd(cm())
    var readFailure: ConversationError?
    var lost = false
    private var authority: UInt8 = 2
    func changeAuthority(_ value: UInt8) { authority = value; profile = try! cp(authority: value) }
    private(set) var sends = 0
    private(set) var receiptGets = 0
    private(set) var profileGets = 0
    private(set) var messageGets = 0
    private var pending: CheckedContinuation<SendReceipt, any Error>?
    private var waiting: CheckedContinuation<Void, Never>?
    private var held = false
    private var dispatched: TextCommand?
    func configure(lost: Bool = false, hold: Bool = false) { self.lost = lost; held = hold }
    func setReceipt(_ value: Data?) { receipt = value }
    func setProfile(_ value: Data) { profile = value }
    func setMessage(_ value: Data) { message = value }
    func failRead(_ error: ConversationError?) { readFailure = error }
    func fetchConversation(_ query: ConversationQuery, scope: ConversationScope) async throws -> Data {
        try scope.check()
        switch query {
        case .snapshot: if let readFailure { throw readFailure }; return try cs(authority: authority)
        case .events: if let readFailure { throw readFailure }; return try ce()
        case .profiles: profileGets += 1; return profile
        case .message: messageGets += 1; return message
        case .receipt:
            receiptGets += 1
            guard let receipt else { throw ConversationError.notFound }; return receipt
        default: throw ConversationError.notFound
        }
    }
    func sendText(_ command: TextCommand, scope: ConversationScope) async throws -> SendReceipt {
        try scope.check(); sends += 1; dispatched = command
        if held { return try await withCheckedThrowingContinuation { pending = $0; waiting?.resume(); waiting = nil } }
        if lost { throw ConversationError.unavailable }
        return .committed(commandID: command.id, messageID: cMessage, version: try MessageVersion("1"))
    }
    func wait() async { if pending != nil { return }; await withCheckedContinuation { waiting = $0 } }
    func finish(lost: Bool) throws {
        guard let dispatched else { return }
        receipt = try cd(["clientMessageId": dispatched.id, "messageId": cMessage, "status": "committed", "version": "1"])
        if lost { pending?.resume(throwing: ConversationError.unavailable) }
        else { pending?.resume(returning: .committed(commandID: dispatched.id, messageID: cMessage, version: try MessageVersion("1"))) }
        pending = nil
    }
}
@Test func conversationOwnedPostOnceUnknown404ThenLateCommit() async throws {
    let disk = try ConversationDisk(); defer { disk.remove() }
    let remote = ConversationRemote(); await remote.configure(lost: true)
    let coordinator = RoomConversationCoordinator(scope: disk.scope, remote: remote, database: disk.db)
    _ = try await coordinator.refresh()
    let command = try TextCommand(roomID: cRoom, membershipScope: ct(), text: "유실 후 재전송하지 않는 메시지")
    let unknown = try await coordinator.send(command)
    #expect(unknown.commands.first?.phase == .unknown)
    _ = try await coordinator.reconcile() // 404 is not proof of failure.
    #expect(await remote.sends == 1); #expect(await remote.receiptGets == 1)
    #expect(try await coordinator.listing().commands.first?.phase == .unknown)
    await remote.setReceipt(try cd(["clientMessageId": command.id, "messageId": cMessage, "status": "committed", "version": "1"]))
    let committed = try await coordinator.reconcile()
    #expect(committed.commands.isEmpty && committed.messages.count == 1)
    let before = await remote.receiptGets
    _ = try await coordinator.reconcile()
    #expect(await remote.receiptGets == before)
    // A receipt retirement leaves no body and no recurring lookup; event tombstones still apply.
    try disk.db.applyEvents(JSONDecoder().decode(ConversationEvents.self, from: ce([["type": "message.deleted", "messageId": cMessage, "version": "2"]])), requestedCursor: "events-0", scope: disk.scope)
    #expect(await remote.sends == 1)
    await remote.setReceipt(try cd(["clientMessageId": command.id, "status": "deleted"]))
    let deleted = try await coordinator.reconcile()
    #expect(deleted.commands.first?.phase == .deleted && deleted.commands.first?.command == nil && deleted.messages.isEmpty)
    #expect(await remote.sends == 1)
}
@Test func conversationDetachedObserverScopeCloseAndColdGetOnly() async throws {
    let disk = try ConversationDisk(); defer { try? FileManager.default.removeItem(at: disk.directory) }
    let remote = ConversationRemote(); await remote.configure(hold: true)
    let coordinator = RoomConversationCoordinator(scope: disk.scope, remote: remote, database: disk.db)
    _ = try await coordinator.refresh()
    let command = try TextCommand(roomID: cRoom, membershipScope: ct(), text: "화면보다 긴 수명")
    let observer = Task { try await coordinator.send(command) }
    await remote.wait(); observer.cancel()
    let durable = try disk.db.conversationListing(scope: disk.scope)
    #expect(durable.commands.first?.phase == .sending)
    disk.scope.invalidate(); try await remote.finish(lost: false)
    await #expect(throws: (any Error).self) { try await observer.value }
    #expect(await remote.sends == 1)
    try disk.close()
    let cold = try ConversationDisk(path: disk.directory); defer { try? cold.close() }
    let coldCoordinator = RoomConversationCoordinator(scope: cold.scope, remote: remote, database: cold.db)
    let restored = try await coldCoordinator.refresh()
    #expect(restored.commands.isEmpty && restored.messages.count == 1)
    #expect(await remote.sends == 1); #expect(await remote.receiptGets >= 1)
}
@Test func conversationForegroundProfilesAndEndpointSpecificAuthority() async throws {
    let disk = try ConversationDisk(); defer { disk.remove() }
    let remote = ConversationRemote(); let coordinator = RoomConversationCoordinator(scope: disk.scope, remote: remote, database: disk.db)
    #expect(try await coordinator.refresh().profiles.first?.nickname == "처음")
    await remote.setProfile(try cp())
    #expect(try await coordinator.refresh().profiles.isEmpty)
    #expect(await remote.profileGets == 2)
    await remote.configure(lost: true)
    let command = try TextCommand(roomID: cRoom, membershipScope: ct(), text: "404 조회")
    _ = try await coordinator.send(command); _ = try await coordinator.reconcile()
    try disk.scope.check() // receipt 404 cannot close the room or falsely fail SEND.
    await remote.failRead(.forbidden)
    await #expect(throws: ConversationError.forbidden) { try await coordinator.poll() }
    #expect(throws: ConversationError.staleScope) { try disk.scope.check() }
}
@Test func conversationRejectedPrewriteCannotSend() async throws {
    let disk = try ConversationDisk(); defer { disk.remove() }
    let remote = ConversationRemote(); let coordinator = RoomConversationCoordinator(scope: disk.scope, remote: remote, database: disk.db)
    _ = try await coordinator.refresh()
    let invalid = try TextCommand(roomID: cRoom, membershipScope: ct(9), text: "다른 기간")
    await #expect(throws: ConversationError.staleScope) { try await coordinator.send(invalid) }
    #expect(await remote.sends == 0)
    disk.scope.invalidate()
    let closed = try TextCommand(roomID: cRoom, membershipScope: ct(), text: "닫힌 권한")
    await #expect(throws: (any Error).self) { try await coordinator.send(closed) }
    #expect(await remote.sends == 0)
}

@Test func conversationAuthorityOnlyChangePreservesUnknownOriginalAndReadsReceiptOnly() async throws {
    let disk = try ConversationDisk(); defer { disk.remove() }
    let remote = ConversationRemote(); await remote.configure(lost: true)
    let old = RoomConversationCoordinator(scope: disk.scope, remote: remote, database: disk.db)
    _ = try await old.refresh()
    let command = try TextCommand(roomID: cRoom, membershipScope: ct(), text: "같은 참여 기간의 원래 내용")
    _ = try await old.send(command)
    disk.scope.invalidate()
    let manifest = try disk.db.beginManifest()
    _ = try disk.db.manifestPage(manifestC(authority: 7), request: manifest)
    let changed = try disk.db.beginConversation(roomID: cRoom, cycle: #require(disk.db.listing().cycle))
    #expect(changed.cacheID != disk.scope.cacheID && changed.room.authorizationRevision == ct(7))
    let before = try #require(disk.db.conversationListing(scope: changed).commands.first)
    #expect(before.phase == .unknown && before.command == command)
    await remote.changeAuthority(7)
    let reopened = RoomConversationCoordinator(scope: changed, remote: remote, database: disk.db)
    let after = try await reopened.refresh()
    #expect(after.commands.first?.command == command && after.commands.first?.phase == .unknown)
    #expect(await remote.sends == 1); #expect(await remote.receiptGets == 1)
}

@Test func conversationNewerCommittedReceiptFetchesNewAuthorizedProjection() async throws {
    let disk = try ConversationDisk(); defer { disk.remove() }; try disk.snapshot([cm("1", text: "이전 내용")])
    let remote = ConversationRemote()
    let command = try TextCommand(roomID: cRoom, membershipScope: ct(), text: "원래 요청")
    try disk.db.admitText(command, scope: disk.scope); try disk.db.claimText(command, scope: disk.scope)
    try disk.db.recordCommandReceipt(.committed(commandID: command.id, messageID: cMessage, version: MessageVersion("2")), expectedID: command.id, scope: disk.scope)
    await remote.setReceipt(try cd(["clientMessageId": command.id, "messageId": cMessage, "status": "committed", "version": "2"]))
    await remote.setMessage(try cd(cm("2", reply: false, text: "새 권한의 내용")))
    let coordinator = RoomConversationCoordinator(scope: disk.scope, remote: remote, database: disk.db)
    let result = try await coordinator.reconcile()
    #expect(result.commands.isEmpty && result.messages.first?.version.rawValue == "2")
    #expect(result.messages.first?.content == .text("새 권한의 내용"))
    #expect(await remote.messageGets == 1); #expect(await remote.sends == 0)
}

@Test func attachmentIntentSurvivesColdReopenWithoutRebindingOrReplay() throws {
    let disk = try ConversationDisk(); defer { try? FileManager.default.removeItem(at: disk.directory) }; try disk.snapshot()
    let attachment = try OutgoingAttachment(type: "PHOTO", assetIds: [cMessage])
    let command = try TextCommand(roomID: cRoom, membershipScope: ct(), attachment: attachment)
    try disk.db.admitText(command, scope: disk.scope); try disk.db.claimText(command, scope: disk.scope)
    let encoded = try command.requestBody()
    #expect(String(data: encoded, encoding: .utf8)?.contains("https:") == false)
    try disk.close()
    let cold = try ConversationDisk(path: disk.directory); defer { try? cold.close() }
    let saved = try #require(cold.db.conversationListing(scope: cold.scope).commands.first)
    #expect(saved.phase == .unknown && saved.command == command)
    #expect(try saved.command?.requestBody() == encoded)
    #expect(throws: (any Error).self) { try cold.db.claimText(command, scope: cold.scope) }
    #expect(throws: (any Error).self) { try OutgoingAttachment(type: "PHOTO", assetIds: [cMessage, cMessage]) }
    #expect(throws: (any Error).self) { try OutgoingAttachment(type: "VIDEO", assetIds: [cMessage, cActor]) }
    #expect(throws: (any Error).self) { try OutgoingAttachment(type: "STICKER", assetIds: [cMessage], stickerId: cPeer) }
}
@Test func featureJournalsCommitScopeAndAccountBlockRetentionAfterLeave() throws {
    let disk = try ConversationDisk(); defer { disk.remove() }; try disk.snapshot()
    let value = Data("{\"id\":\"scoped-test-value\"}".utf8)
    try disk.db.putFeature(.media, id: cMessage, value: value, scope: disk.scope)
    try disk.db.putFeature(.moderation, id: cMessage, value: value, scope: disk.scope)
    try disk.db.putFeature(.blockRooms, id: cRoom, value: Data(("{\"id\":\"" + cRoom + "\"}").utf8), scope: disk.scope)
    #expect(try disk.db.featureRecords(.media, scope: disk.scope) == [value])
    disk.scope.invalidate()
    #expect(throws: (any Error).self) { try disk.db.putFeature(.media, id: cActor, value: value, scope: disk.scope) }
    let page: MembershipPage = try decodeC(["schemaVersion": 2,"resetRequired": false,"rooms": [],"generation": ct(7),"complete": true,"nextCursor": NSNull()], MembershipPage.self)
    _ = try disk.db.manifestPage(page, request: disk.db.beginManifest())
    #expect(try disk.db.accountRecords(.moderation, room: cRoom) == [value])
    #expect(try disk.db.accountRecords(.blockRooms).count == 1)
    try disk.db.putAccountFeature(.unblocks, room: cRoom, id: cMessage, value: value)
    disk.account.invalidate()
    #expect(throws: (any Error).self) { try disk.db.accountRecords(.moderation) }
    #expect(throws: (any Error).self) { try disk.db.putAccountFeature(.unblocks, room: cRoom, id: cPeer, value: value) }
}
@Test func acknowledgedDeleteBlocksLateProjectionAndQuotedCopies() throws {
    let disk = try ConversationDisk(); defer { disk.remove() }
    var quoted = cm(); quoted["id"] = cPeer
    quoted["quote"] = ["id": cMessage, "content": ["type":"TEXT","text":"인용된 내용"]]
    try disk.snapshot([cm(), quoted])
    try disk.db.blockProjection(cMessage, scope: disk.scope)
    #expect(try disk.db.conversationListing(scope: disk.scope).messages.isEmpty)
    try disk.db.applySingleMessage(decodeC(cm("999"), ConversationMessage.self), scope: disk.scope)
    try disk.db.applySingleMessage(decodeC(quoted, ConversationMessage.self), scope: disk.scope)
    #expect(try disk.db.conversationListing(scope: disk.scope).messages.isEmpty)
    quoted["quote"] = NSNull()
    try disk.db.applySingleMessage(decodeC(quoted, ConversationMessage.self), scope: disk.scope)
    #expect(try disk.db.conversationListing(scope: disk.scope).messages.map(\.id) == [cPeer])
}
