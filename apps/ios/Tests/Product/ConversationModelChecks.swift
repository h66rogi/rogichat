import Foundation

private actor ModelConversation: ConversationCoordinating {
    nonisolated let scope: ConversationScope
    var value: ConversationListing
    private var pending: CheckedContinuation<ConversationListing, any Error>?
    private var command: TextCommand?
    private var prewriteFailure = false
    private var readFailure = false
    private(set) var sends = 0
    init(scope: ConversationScope, value: ConversationListing) { self.scope = scope; self.value = value }
    func refresh() async throws -> ConversationListing { if readFailure { throw ConversationError.unavailable }; return value }
    func poll() async throws -> ConversationListing { try await refresh() }
    func history() async throws -> ConversationListing { value }
    func recipients(after: String?) async throws -> PrivateRecipients { try JSONDecoder().decode(PrivateRecipients.self, from: Data(#"{"recipients":[],"next":null}"#.utf8)) }
    func send(_ command: TextCommand) async throws -> ConversationListing {
        guard !prewriteFailure else { throw ConversationError.persistence }
        sends += 1; self.command = command
        return try await withCheckedThrowingContinuation { pending = $0 }
    }
    func reconcile() async throws -> ConversationListing { value }
    func containsCommand(_ id: String) async throws -> Bool { command?.id == id }
    func listing() async throws -> ConversationListing { try scope.check(); return value }
    func wait(_ stage: String) async {
        let deadline = Date().addingTimeInterval(3)
        while pending == nil {
            precondition(Date() < deadline, "\(stage): send did not reach the conversation coordinator")
            try? await Task.sleep(for: .milliseconds(1))
        }
    }
    func failPrewrite(_ value: Bool) { prewriteFailure = value }
    func failRead() { readFailure = true }
    func lastCommand() -> TextCommand? { command }
    func complete(_ phase: TextCommandPhase) {
        guard let command else { return }
        value = ConversationListing(messages: value.messages, commands: [StoredTextCommand(id: command.id, phase: phase, command: command, messageID: nil, version: nil)], profiles: [], eventCursor: "events", historyCursor: nil, ready: true, profilesComplete: true, profileCursor: nil)
        pending?.resume(returning: value); pending = nil
    }
    func replace(_ value: ConversationListing) { self.value = value }
}
@main struct ConversationModelChecks {
    static let roomID = "00000000-0000-4000-8000-000000000001"
    static let actorID = "00000000-0000-4000-8000-000000000002"
    static let peerID = "00000000-0000-4000-8000-000000000003"
    static let messageID = "00000000-0000-4000-8000-000000000004"
    static func token(_ byte: UInt8) -> String { Data(repeating: byte, count: 32).base64EncodedString().replacingOccurrences(of: "+", with: "-").replacingOccurrences(of: "/", with: "_").replacingOccurrences(of: "=", with: "") }
    static func scope(mode: String = "GROUP", role: String = "MEMBER") throws -> ConversationScope {
        let object: [String: Any] = ["roomId": roomID, "name": "대화", "mode": mode, "actorId": actorID, "role": role, "membershipScope": token(1), "authorizationRevision": token(2)]
        let room = try JSONDecoder().decode(MembershipRoom.self, from: JSONSerialization.data(withJSONObject: object))
        let account = try RoomsScope(partition: token(3), clientScope: UUID(), expiresAt: Date().addingTimeInterval(3600))
        return ConversationScope(account: account, room: room, deviceID: roomID, cycle: UUID().uuidString)
    }
    static func message(reply: Bool = true, text: String = "답장할 메시지") throws -> ConversationMessage {
        let object: [String: Any] = ["id": messageID, "version": "1", "createdAt": "2026-09-20T01:02:03.004Z", "audience": "SHARED", "author": ["kind": "member", "actorId": peerID, "nickname": "다른 사용자", "avatar": NSNull()], "content": ["type": "TEXT", "text": text], "quote": NSNull(), "counterpart": NSNull(), "allowedActions": ["reply": reply, "publish": false, "delete": false]]
        return try JSONDecoder().decode(ConversationMessage.self, from: JSONSerialization.data(withJSONObject: object))
    }
    static func listing(_ messages: [ConversationMessage] = []) -> ConversationListing { ConversationListing(messages: messages, commands: [], profiles: [], eventCursor: "events", historyCursor: nil, ready: true, profilesComplete: true, profileCursor: nil) }
    static func check(_ value: Bool) { precondition(value) }
    @MainActor static func finish(_ model: ConversationScreenModel) async throws {
        let deadline = Date().addingTimeInterval(3)
        while model.sending { precondition(Date() < deadline); try await Task.sleep(for: .milliseconds(1)) }
    }
    @MainActor static func main() async throws {
        let scope = try scope(mode: "FAN", role: "STREAMER"); let original = try message()
        let remote = ModelConversation(scope: scope, value: listing([original])); let model = ConversationScreenModel(coordinator: remote)
        await model.load(); model.draft = "  원문  "
        await remote.failPrewrite(true); model.send(); try await finish(model)
        check(model.draft == "  원문  " && model.error != nil)
        check(await remote.sends == 0)
        await remote.failPrewrite(false)
        model.reply(to: original); check(model.privateTarget == peerID && model.quote?.id == messageID)
        model.send(); check(model.sending && !model.canSend)
        await remote.wait("owner private text")
        check(await remote.lastCommand()?.intent == "PRIVATE")
        check(await remote.lastCommand()?.quoteID == messageID)
        model.send(); check(await remote.sends == 1)
        await remote.complete(.unknown); try await finish(model)
        check(model.draft.isEmpty && model.quote == nil && model.listing?.commands.first?.phase == .unknown)
        await remote.failRead(); await model.refresh()
        check(model.listing?.commands.first?.phase == .unknown && model.error != nil)
        // A new draft typed while the owned command awaits must never be erased.
        let second = ModelConversation(scope: scope, value: listing([original])); let other = ConversationScreenModel(coordinator: second)
        await other.load(); other.draft = "첫 메시지"; other.send(); await second.wait("owner shared text")
        check(await second.lastCommand()?.intent == "SHARED")
        other.draft = "다음 메시지"; await second.complete(.unknown); try await finish(other)
        check(other.draft == "다음 메시지")
        other.reply(to: original)
        let replacement = try message(text: "권한에 맞게 바뀐 내용")
        await second.replace(listing([replacement])); await other.refresh()
        check(other.quote == replacement) // Equal version and same recipient must replace the full quote.
        let changed = try message(reply: false)
        await second.replace(listing([changed])); await other.refresh(); other.reply(to: original)
        check(other.quote == nil) // Old row closure cannot grant an action on a changed equal-version projection.
        check(other.targetNeedsReview && !other.canSend)
        other.cancelReply(); check(!other.targetNeedsReview)
        other.draft = "늦은 응답"; other.send(); await second.wait("owner late text")
        scope.invalidate(); await second.complete(.committed); try await finish(other)
        check(!other.active && other.listing == nil && other.draft.isEmpty && !other.canSend)
        check(await second.sends == 2)
        let fanScope = try Self.scope(mode: "FAN", role: "FAN")
        let fanRemote = ModelConversation(scope: fanScope, value: listing([original]))
        let fan = ConversationScreenModel(coordinator: fanRemote)
        await fan.load(); fan.draft = "방장에게"
        check(fan.canSend && fan.targetName == "방장" && fan.sendAccessibilityLabel == "메시지 보내기")
        fan.send(); await fanRemote.wait("fan first text")
        check(await fanRemote.lastCommand()?.intent == "ROOM_OWNER")
        check(await fanRemote.lastCommand()?.recipientActorID == nil)
        await fanRemote.complete(.unknown); try await finish(fan)
        fan.reply(to: original); check(fan.quote == nil)
        fan.draft = "계속 방장에게"; fan.send(); await fanRemote.wait("fan second text")
        check(await fanRemote.lastCommand()?.intent == "ROOM_OWNER")
        check(await fanRemote.lastCommand()?.recipientActorID == nil)
        await fanRemote.complete(.committed); try await finish(fan)
        let attachment = Task { try await fan.sendAttachment(OutgoingAttachment(type: "STICKER", stickerId: messageID)) }
        await fanRemote.wait("fan sticker"); check(await fanRemote.lastCommand()?.intent == "ROOM_OWNER")
        await fanRemote.complete(.unknown); _ = try await attachment.value
        let ownerScope = try Self.scope(mode: "FAN", role: "STREAMER")
        let ownerMedia = ModelConversation(scope: ownerScope, value: listing([original]))
        let owner = ConversationScreenModel(coordinator: ownerMedia)
        await owner.load(); owner.reply(to: original)
        let privateAttachment = Task { try await owner.sendAttachment(OutgoingAttachment(type: "PHOTO", assetIds: [messageID])) }
        await ownerMedia.wait("owner private photo")
        check(await ownerMedia.lastCommand()?.intent == "PRIVATE")
        check(await ownerMedia.lastCommand()?.recipientActorID == peerID)
        check(await ownerMedia.lastCommand()?.quoteID == messageID)
        await ownerMedia.complete(.committed); _ = try await privateAttachment.value
        check(owner.quote == nil)
        let sharedAttachment = Task { try await owner.sendAttachment(OutgoingAttachment(type: "STICKER", stickerId: messageID)) }
        await ownerMedia.wait("owner shared sticker"); check(await ownerMedia.lastCommand()?.intent == "SHARED")
        await ownerMedia.complete(.committed); _ = try await sharedAttachment.value
        let withHistory = ConversationListing(messages: [original], commands: [], profiles: [], eventCursor: "events",
            historyCursor: "older", ready: true, profilesComplete: true, profileCursor: nil)
        let historyRemote = ModelConversation(scope: fanScope, value: withHistory)
        let historyModel = ConversationScreenModel(coordinator: historyRemote)
        await historyModel.load()
        check(historyModel.canLoadHistory && historyModel.historyRevision == 0)
        let loadedHistory = await historyModel.history()
        check(loadedHistory && historyModel.historyRevision == 1)
        print("iOS conversation model: private fan inbox, owner broadcast and selected private replies, media intents, durable draft and scope checks passed")
    }
}
