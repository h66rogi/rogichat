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
    private(set) var sending = false
    private(set) var checking = false
    private(set) var error: String?
    var draft = ""
    private(set) var quote: ConversationMessage?
    private var privateReplyTarget: String?
    private var privateReplyName: String?
    private var sendTask: Task<Void, Never>?
    init(coordinator: any ConversationCoordinating) { self.coordinator = coordinator }
    var active: Bool { (try? scope.check()) != nil }
    var targetName: String { privateReplyName ?? "전체 채팅" }
    var privateTarget: String? { privateReplyTarget }
    var canSend: Bool {
        active && listing?.ready == true && !sending &&
        (privateTarget == nil || quote != nil && scope.room.role == "STREAMER") && (try? ConversationWire.normalizedText(draft)) != nil
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
    func history() async {
        guard active, !loading, !loadingHistory, !sending, !checking, listing?.historyCursor != nil else { return }
        loadingHistory = true; error = nil; defer { loadingHistory = false }
        do { let value = try await coordinator.history(); try scope.check(); state = .loaded(value); clearStaleReply(value) }
        catch { await failed(error) }
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
        quote = current; privateReplyTarget = target
        privateReplyName = listing?.profiles.first(where: { $0.id == target })?.nickname ?? (current.author.actorID == target ? current.author.displayName : "비공개 답장")
    }
    func cancelReply() { quote = nil; privateReplyTarget = nil; privateReplyName = nil }
    private func clearStaleReply(_ value: ConversationListing) {
        if let quote {
            guard let current = value.messages.first(where: { $0.id == quote.id }), current.allowedActions.reply,
                  current.replyRecipient == privateReplyTarget else { cancelReply(); return }
            self.quote = current
        }
    }
    func send() {
        guard canSend else { return }
        let input = draft; let target = privateTarget; let quoteID = quote?.id
        let command: TextCommand
        do { command = try TextCommand(roomID: scope.room.id, membershipScope: scope.room.membershipScope, recipientActorID: target, quoteID: quoteID, text: input) }
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
        guard active, listing?.ready == true, !sending,
              (privateTarget == nil || quote != nil && scope.room.role == "STREAMER") else { throw ConversationError.busy }
        let command = try TextCommand(roomID: scope.room.id, membershipScope: scope.room.membershipScope,
            recipientActorID: privateTarget, quoteID: quote?.id, attachment: attachment)
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
