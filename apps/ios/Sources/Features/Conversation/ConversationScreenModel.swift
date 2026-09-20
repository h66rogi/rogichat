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
    private(set) var recipients: [PrivateRecipient] = []
    private(set) var recipientsNext: String?
    private(set) var recipientsLoading = false
    private(set) var recipientsError: String?
    var draft = ""
    private(set) var recipient: PrivateRecipient?
    private(set) var quote: ConversationMessage?
    private var privateReplyTarget: String?
    private var privateReplyName: String?
    private var sendTask: Task<Void, Never>?
    init(coordinator: any ConversationCoordinating) { self.coordinator = coordinator }
    var active: Bool { (try? scope.check()) != nil }
    var sharedAllowed: Bool { scope.room.mode == "GROUP" || scope.room.role == "STREAMER" }
    var targetName: String { recipient?.nickname ?? privateReplyName ?? (sharedAllowed ? "전체 대화" : "받는 사람 선택") }
    var privateTarget: String? { recipient?.id ?? privateReplyTarget }
    var canSend: Bool {
        active && listing?.ready == true && !loading && !loadingHistory && !sending && !checking &&
        (sharedAllowed || privateTarget != nil) && (try? ConversationWire.normalizedText(draft)) != nil
    }
    func load() async { if listing == nil, !loading { await refresh() } }
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
    func loadRecipients(more: Bool = false) async {
        guard active, !recipientsLoading, scope.room.mode == "FAN", !more || recipientsNext != nil else { return }
        recipientsLoading = true; recipientsError = nil; defer { recipientsLoading = false }
        if !more { recipients = []; recipientsNext = nil }
        do {
            let page = try await coordinator.recipients(after: more ? recipientsNext : nil)
            try scope.check(); recipients = more ? recipients + page.recipients : page.recipients; recipientsNext = page.next
        } catch { recipientsError = Self.message(error) }
    }
    func choose(_ value: PrivateRecipient?) {
        guard active, value == nil ? sharedAllowed : recipients.contains(where: { $0.id == value?.id }) else { return }
        recipient = value; privateReplyTarget = nil; privateReplyName = nil; quote = nil
    }
    func reply(to displayed: ConversationMessage) {
        guard active, let current = listing?.messages.first(where: { $0.id == displayed.id }), current == displayed,
              current.allowedActions.reply, let target = current.replyRecipient, target != scope.room.actorId else { return }
        quote = current; recipient = nil; privateReplyTarget = target
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
        guard active, listing?.ready == true, !loading, !loadingHistory, !sending, !checking,
              sharedAllowed || privateTarget != nil else { throw ConversationError.busy }
        let command = try TextCommand(roomID: scope.room.id, membershipScope: scope.room.membershipScope,
            recipientActorID: privateTarget, quoteID: quote?.id, attachment: attachment)
        sending = true; error = nil; defer { sending = false }
        do {
            let result = try await coordinator.send(command); try scope.check(); state = .loaded(result)
            if try await coordinator.containsCommand(command.id) { cancelReply() }
            return command
        } catch { await failed(error); throw error }
    }
    private func failed(_ failure: any Error) async {
        if !active {
            state = .failed(failure); recipients = []; recipient = nil; cancelReply(); draft = ""
        } else if let current = try? await coordinator.listing() {
            state = .loaded(current); clearStaleReply(current)
        } else { state = .failed(failure) }
        error = Self.message(failure)
    }
    private static func message(_ error: any Error) -> String { (error as? LocalizedError)?.errorDescription ?? "대화를 확인하지 못했어요. 다시 시도해 주세요." }
}
