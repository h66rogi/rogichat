import Foundation
import Observation
#if canImport(RogichatRooms)
import RogichatRooms
#endif

// Loadable/refresh/next-page state and constructor injection adapted from
// Meloming NotificationsViewModel. Message UX and durable send ownership are new.
@MainActor @Observable
final class ConversationScreenModel {
    let coordinator: any ConversationCoordinating
    var scope: ConversationScope { coordinator.scope }
    private(set) var state: Loadable<ConversationListing> = .idle
    var listing: ConversationListing? { state.value }
    var loading: Bool { state.isLoading }
    private(set) var loadingHistory = false
    private(set) var historyRevision = 0
    private(set) var sending = false
    private(set) var checking = false
    private(set) var error: String?
    var draft = ""
    private(set) var restoredAttachment: OutgoingAttachment?
    private(set) var quote: ConversationMessage?
    private var privateReplyTarget: String?
    private var privateReplyName: String?
    private(set) var targetNeedsReview = false
    private var sendTask: Task<Void, Never>?
    init(coordinator: any ConversationCoordinating) { self.coordinator = coordinator }
    var active: Bool { (try? scope.check()) != nil }
    private var sendsToRoomOwner: Bool { scope.room.mode == "FAN" && scope.room.role == "FAN" }
    var targetName: String { privateReplyName ?? (sendsToRoomOwner ? "방장" : "전체 채팅") }
    var composerPrompt: String { privateTarget != nil ? "답장 입력" : "메시지 입력" }
    var sendAccessibilityLabel: String {
        if privateTarget != nil { return "답장 보내기" }
        return "메시지 보내기"
    }
    var privateTarget: String? { privateReplyTarget }
    var canLoadHistory: Bool {
        active && !loading && !loadingHistory && !sending && !checking && listing?.historyCursor != nil
    }
    var canSend: Bool {
        active && listing?.ready == true && !sending && !targetNeedsReview &&
        (privateTarget == nil || quote != nil && scope.room.role == "STREAMER") &&
        (restoredAttachment != nil ? (restoredAttachment?.type == "STICKER" ? draft.isEmpty : draft.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty || (try? ConversationWire.normalizedText(draft)) != nil)
            : (try? ConversationWire.normalizedText(draft)) != nil)
    }
    var draftLimitNotice: String? {
        let normalized = draft.precomposedStringWithCanonicalMapping
        if normalized.unicodeScalars.count > 4000 || normalized.utf8.count > 16384 || normalized.contains("\0") {
            return "메시지는 4,000자, 16KB 이내로 작성해 주세요."
        }
        return nil
    }
    func load() async {
        if listing?.ready == true { await poll(); return }
        if listing == nil, !loading, let local = try? await coordinator.listing() {
            state = .loaded(local)
        }
        await refresh()
    }
    func refresh() async {
        guard !loading, !loadingHistory, !sending, !checking else { return }
        let previous = listing; state = .loading(previous: previous); error = nil
        do { let value = try await coordinator.refresh(); try scope.check(); state = .loaded(value); clearStaleReply(value) }
        catch { await failed(error) }
    }
    func poll() async {
        guard active, listing?.ready == true, !loading, !loadingHistory, !sending, !checking else { return }
        checking = true; defer { checking = false }
        do { let value = try await coordinator.poll(); try scope.check(); state = .loaded(value); clearStaleReply(value) }
        catch { await failed(error) }
    }
    @discardableResult func history() async -> Bool {
        guard canLoadHistory else { return false }
        loadingHistory = true; error = nil; defer { loadingHistory = false }
        do {
            let value = try await coordinator.history(); try scope.check()
            historyRevision &+= 1; state = .loaded(value); clearStaleReply(value)
            return true
        } catch { await failed(error); return false }
    }
    func checkCommands() async {
        guard active, !loading, !loadingHistory, !sending, !checking else { return }
        checking = true; error = nil; defer { checking = false }
        do { let value = try await coordinator.reconcile(); try scope.check(); state = .loaded(value); clearStaleReply(value) }
        catch { await failed(error) }
    }
    func reply(to displayed: ConversationMessage) {
        guard active, scope.room.role == "STREAMER", let current = listing?.messages.first(where: { $0.id == displayed.id }), current == displayed,
              current.allowedActions.reply, current.author.actorID != scope.room.actorId,
              let target = current.replyRecipient, target != scope.room.actorId else { return }
        quote = current; privateReplyTarget = target; targetNeedsReview = false
        privateReplyName = listing?.profiles.first(where: { $0.id == target })?.nickname ?? (current.author.actorID == target ? current.author.displayName : "비공개 답장")
    }
    func cancelReply() {
        if privateReplyTarget != nil || targetNeedsReview { restoredAttachment = nil }
        quote = nil; privateReplyTarget = nil; privateReplyName = nil; targetNeedsReview = false
    }
    func clearRestoredAttachment() { restoredAttachment = nil }
    /** A rejected command is a confirmed failure. Reopen its content as a new, inspectable draft. */
    func restoreRejected(_ stored: StoredTextCommand) {
        guard stored.phase == .rejected, let command = stored.command,
              command.roomID == scope.room.id, command.membershipScope == scope.room.membershipScope,
              listing?.ready == true, !sending else { return }
        guard draft.isEmpty, restoredAttachment == nil else {
            error = "작성 중인 메시지를 먼저 확인해 주세요."; return
        }
        if command.intent == "PRIVATE" {
            guard scope.room.role == "STREAMER", let quoteID = command.quoteID,
                  let original = listing?.messages.first(where: { $0.id == quoteID && $0.replyRecipient == command.recipientActorID && $0.allowedActions.reply }) else {
                error = "답장할 메시지를 다시 선택해 주세요."; return
            }
            quote = original; privateReplyTarget = command.recipientActorID
            targetNeedsReview = false
            privateReplyName = listing?.profiles.first(where: { $0.id == command.recipientActorID })?.nickname
                ?? (original.author.actorID == command.recipientActorID ? original.author.displayName : "선택한 팬")
        } else if (command.intent == "SHARED" && scope.room.role != "STREAMER") ||
                  (command.intent == "ROOM_OWNER" && !sendsToRoomOwner) {
            error = "지금은 이 메시지를 보낼 수 없어요."; return
        } else { cancelReply() }
        draft = command.attachmentContent?.caption ?? command.text
        restoredAttachment = command.attachmentContent
        error = nil
    }
    private func clearStaleReply(_ value: ConversationListing) {
        if let quote {
            guard let current = value.messages.first(where: { $0.id == quote.id }), current.allowedActions.reply,
                  current.replyRecipient == privateReplyTarget else {
                self.quote = nil; privateReplyTarget = nil; privateReplyName = nil; targetNeedsReview = true
                error = "답장할 글을 다시 선택해 주세요. 작성한 내용은 남아 있어요."
                return
            }
            self.quote = current
        }
    }
    func send() {
        guard canSend else { return }
        if let restoredAttachment {
            let originalDraft = draft
            let originalTarget = privateTarget
            let originalQuoteID = quote?.id
            Task {
                guard canSend, draft == originalDraft, privateTarget == originalTarget,
                      quote?.id == originalQuoteID, self.restoredAttachment == restoredAttachment else { return }
                do {
                    let caption = originalDraft.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty ? nil : try ConversationWire.normalizedText(originalDraft)
                    let attachment = try OutgoingAttachment(type: restoredAttachment.type, assetIds: restoredAttachment.assetIds,
                        stickerId: restoredAttachment.stickerId, caption: caption)
                    let command = try await sendAttachment(attachment)
                    if (try? await coordinator.containsCommand(command.id)) == true,
                       self.restoredAttachment == restoredAttachment { self.restoredAttachment = nil }
                }
                catch { /* sendAttachment retains the draft and reports the reason. */ }
            }
            return
        }
        let input = draft; let target = privateTarget; let quoteID = quote?.id
        let command: TextCommand
        do { command = try TextCommand(roomID: scope.room.id, membershipScope: scope.room.membershipScope, recipientActorID: target, quoteID: quoteID, toRoomOwner: sendsToRoomOwner, text: input) }
        catch { self.error = Self.message(error); return }
        sending = true; error = nil
        sendTask = Task {
            defer { self.sending = false; self.sendTask = nil }
            do { let value = try await self.coordinator.send(command); try self.scope.check(); self.state = .loaded(value) }
            catch { await self.failed(error) }
            // Clear only a durably admitted draft, never a failed pre-write intent.
            if (try? await self.coordinator.containsCommand(command.id)) == true,
               self.draft == input, self.privateTarget == target, self.quote?.id == quoteID {
                self.draft = ""; self.cancelReply()
            }
        }
    }
    func sendAttachment(_ attachment: OutgoingAttachment) async throws -> TextCommand {
        guard active, listing?.ready == true, !sending, !targetNeedsReview,
              (privateTarget == nil || quote != nil && scope.room.role == "STREAMER") else { throw ConversationError.busy }
        let command = try TextCommand(roomID: scope.room.id, membershipScope: scope.room.membershipScope,
            recipientActorID: privateTarget, quoteID: quote?.id, toRoomOwner: sendsToRoomOwner, attachment: attachment)
        let originalDraft = draft
        sending = true; error = nil; defer { sending = false }
        do {
            let result = try await coordinator.send(command); try scope.check(); state = .loaded(result)
            if try await coordinator.containsCommand(command.id) {
                cancelReply()
                if attachment.caption != nil && draft == originalDraft { draft = "" }
            }
            return command
        } catch { await failed(error); throw error }
    }
    private func failed(_ failure: any Error) async {
        if !active {
            state = .failed(failure); cancelReply(); draft = ""
        } else if let current = try? await coordinator.listing() {
            state = .loaded(current); clearStaleReply(current)
        } else { state = .failed(failure) }
        error = Self.message(failure)
    }
    private static func message(_ error: any Error) -> String { (error as? LocalizedError)?.errorDescription ?? "대화를 확인하지 못했어요. 다시 시도해 주세요." }
}
