import Foundation

// Typed repository injection follows the extracted NotificationRepository pattern.
// Authority, durable commands and message merge are new Rogichat implementations.
public protocol ConversationFetching: Sendable {
    func fetchConversation(_ query: ConversationQuery, scope: ConversationScope) async throws -> Data
    func sendText(_ command: TextCommand, scope: ConversationScope) async throws -> SendReceipt
}
public actor RoomConversationCoordinator: ConversationCoordinating {
    public nonisolated let scope: ConversationScope
    private let remote: any ConversationFetching
    private let database: RoomsDatabase
    private var reading = false
    private var sendTask: Task<ConversationListing, any Error>?
    private var recipientsLoading = false
    private var recipientsRevision = UUID()
    private var recipientCandidates: Set<String> = []
    private var recipientNext: String?
    private var recipientVisited: Set<String> = []
    init(scope: ConversationScope, remote: any ConversationFetching, database: RoomsDatabase) {
        self.scope = scope; self.remote = remote; self.database = database
    }
    public func containsCommand(_ id: String) throws -> Bool { try database.containsText(id, scope: scope) }
    public func listing() throws -> ConversationListing { try scope.check(); return try database.conversationListing(scope: scope) }
    private func read<T: Decodable>(_ type: T.Type, _ query: ConversationQuery) async throws -> T {
        try scope.check()
        let data: Data
        do { data = try await remote.fetchConversation(query, scope: scope) }
        catch {
            switch query {
            case .snapshot, .events, .history, .profiles:
                if error as? ConversationError == .forbidden || error as? ConversationError == .notFound { scope.invalidate() }
            default: break
            }
            throw error
        }
        try scope.check()
        do { return try JSONDecoder().decode(type, from: data) } catch { throw ConversationError.invalidResponse }
    }
    public func refresh() async throws -> ConversationListing {
        guard !reading else { throw ConversationError.busy }; reading = true
        defer { reading = false }
        do {
            let current = try listing()
            if current.ready { try await events() }
            else {
                let page = try await read(ConversationSnapshot.self, .snapshot)
                try database.applySnapshot(page, scope: scope)
            }
            // Profile/action privacy can change at the same message version.
            try database.beginProfiles(scope: scope)
            try await profiles()
            try await refreshVisibleProjections()
            // Cold restored intents only GET receipts. This never calls sendText.
            try await reconcileOwned()
            return try listing()
        } catch {
            closeIfAuthorityChanged(error)
            throw error
        }
    }
    public func poll() async throws -> ConversationListing {
        guard !reading, sendTask == nil else { throw ConversationError.busy }
        guard try listing().ready else { return try await refresh() }
        reading = true; defer { reading = false }
        do { try await events(); try await reconcileOwned(); return try listing() }
        catch { closeIfAuthorityChanged(error); throw error }
    }
    private func refreshVisibleProjections() async throws {
        let messages = try listing().messages
        for previous in messages {
            do {
                let current = try await read(ConversationMessage.self, .message(messageID: previous.id))
                guard current.id == previous.id else { throw ConversationError.invalidResponse }
                try database.applySingleMessage(current, scope: scope)
            } catch ConversationError.notFound {
                try database.hideProjection(messageID: previous.id, scope: scope)
            } catch ConversationError.forbidden {
                try database.hideProjection(messageID: previous.id, scope: scope)
            }
        }
    }
    private func events() async throws {
        var pages = 0; var visited: Set<String> = []
        while let cursor = try listing().eventCursor {
            guard visited.insert(cursor).inserted else { throw ConversationError.invalidResponse }
            let page = try await read(ConversationEvents.self, .events(cursor: cursor))
            try database.applyEvents(page, requestedCursor: cursor, scope: scope)
            pages += 1
            guard pages <= 10_001 else { throw ConversationError.invalidResponse }
            if !page.hasMore { return }
        }
    }
    private func profiles() async throws {
        var cursor = try listing().profileCursor; var pages = 0
        while true {
            let page = try await read(ConversationProfiles.self, .profiles(cursor: cursor))
            try database.applyProfiles(page, requestedCursor: cursor, scope: scope)
            pages += 1
            guard pages <= 10_001 else { throw ConversationError.invalidResponse }
            if page.complete { return }; cursor = page.nextCursor
        }
    }
    public func history() async throws -> ConversationListing {
        guard !reading else { throw ConversationError.busy }; reading = true
        defer { reading = false }
        do {
            guard let cursor = try listing().historyCursor else { return try listing() }
            let page = try await read(ConversationHistory.self, .history(cursor: cursor))
            try database.applyHistory(page, requestedCursor: cursor, scope: scope)
            return try listing()
        } catch { closeIfAuthorityChanged(error); throw error }
    }
    public func recipients(after: String?) async throws -> PrivateRecipients {
        guard !recipientsLoading else { throw ConversationError.busy }
        recipientsLoading = true; defer { recipientsLoading = false }
        try scope.check()
        guard scope.room.mode == "FAN" else { throw ConversationError.forbidden }
        let ticket: UUID
        if after == nil { recipientsRevision = UUID(); recipientCandidates = []; recipientVisited = []; recipientNext = nil }
        else if after != recipientNext { throw ConversationError.staleScope }
        ticket = recipientsRevision
        let page = try await read(PrivateRecipients.self, .recipients(after: after))
        guard recipientsRevision == ticket else { throw ConversationError.staleScope }
        if let after { guard page.recipients.allSatisfy({ $0.id > after }) else { throw ConversationError.invalidResponse } }
        guard zip(page.recipients, page.recipients.dropFirst()).allSatisfy({ $0.0.id < $0.1.id }),
              page.recipients.allSatisfy({ !recipientCandidates.contains($0.id) && $0.id != scope.room.actorId }) else { throw ConversationError.invalidResponse }
        if let next = page.next, !recipientVisited.insert(next).inserted { throw ConversationError.invalidResponse }
        recipientCandidates.formUnion(page.recipients.map(\.id)); recipientNext = page.next
        return page
    }
    public func send(_ command: TextCommand) async throws -> ConversationListing {
        guard sendTask == nil, !reading else { throw ConversationError.busy }
        try scope.check()
        guard command.roomID == scope.room.id, command.membershipScope == scope.room.membershipScope else { throw ConversationError.staleScope }
        if let recipient = command.recipientActorID, command.quoteID == nil, !recipientCandidates.contains(recipient) { throw ConversationError.forbidden }
        try database.admitText(command, scope: scope) // Actual COMMIT before Task or HTTP.
        let operation = Task { try await self.dispatch(command) }
        sendTask = operation
        return try await operation.value
    }
    private func dispatch(_ command: TextCommand) async throws -> ConversationListing {
        defer { sendTask = nil }
        try database.claimText(command, scope: scope)
        do {
            let receipt = try await remote.sendText(command, scope: scope)
            try scope.check()
            try database.recordSendReceipt(receipt, expected: command, scope: scope)
        } catch {
            try scope.check()
            switch error as? ConversationError {
            case .membershipChanged:
                try database.markTextRejected(id: command.id, blocked: true, scope: scope); scope.invalidate(); throw error
            case .forbidden, .conflict, .invalidText:
                try database.markTextRejected(id: command.id, blocked: false, scope: scope)
            default:
                try database.markTextUnknown(id: command.id, scope: scope)
            }
            return try listing()
        }
        if !reading {
            reading = true
            defer { reading = false }
            // Storage ACK remains truthful if the projection lookup is temporarily unavailable.
            do { try await reconcileOwned() } catch { closeIfAuthorityChanged(error) }
        }
        return try listing()
    }
    public func reconcile() async throws -> ConversationListing {
        guard !reading, sendTask == nil else { throw ConversationError.busy }; reading = true
        defer { reading = false }
        do { try await reconcileOwned(); return try listing() }
        catch { closeIfAuthorityChanged(error); throw error }
    }
    private func reconcileOwned() async throws {
        let saved = try listing()
        for command in saved.commands where command.phase == .unknown || command.phase == .committed || (sendTask == nil && (command.phase == .queued || command.phase == .sending)) {
            try scope.check()
            if command.phase == .queued || command.phase == .sending { try database.markTextUnknown(id: command.id, scope: scope) }
            do {
                let receipt = try await read(CommandReceipt.self, .receipt(commandID: command.id))
                try database.recordCommandReceipt(receipt, expectedID: command.id, scope: scope)
            } catch ConversationError.notFound {
                if let messageID = command.messageID { try database.hideProjection(messageID: messageID, scope: scope) }
                continue // Ambiguous; never new ID, success or SEND.
            }
            guard let current = try listing().commands.first(where: { $0.id == command.id }), current.phase == .committed,
                  let messageID = current.messageID else { continue }
            if let version = current.version, try listing().messages.contains(where: { $0.id == messageID && $0.version >= version }) { continue }
            do {
                let message = try await read(ConversationMessage.self, .message(messageID: messageID))
                guard message.id == messageID else { throw ConversationError.invalidResponse }
                try database.applySingleMessage(message, scope: scope)
            } catch ConversationError.notFound { try database.hideProjection(messageID: messageID, scope: scope) } // Not terminal deletion.
              catch ConversationError.forbidden { try database.hideProjection(messageID: messageID, scope: scope) }
        }
    }
    private func closeIfAuthorityChanged(_ error: any Error) {
        if error as? ConversationError == .membershipChanged || error as? ConversationError == .staleScope { scope.invalidate(); recipientCandidates = [] }
    }
}
