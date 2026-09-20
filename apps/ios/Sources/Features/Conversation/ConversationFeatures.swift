import Foundation
import Observation
import RogichatRooms

struct ConversationMediaScope: MediaScope {
    let original: ConversationScope
    var presentationID: String { original.account.clientScope.uuidString + ":" + original.cacheID }
    var roomID: String? { original.room.id }
    func check() throws { try original.check(); try MediaScratchLifecycle.shared.prepare() }
}
struct ConversationMediaTransport: MediaTransport {
    let session: AppSession
    let original: ConversationScope
    func perform(_ request: MediaRequest, scope: any MediaScope) async throws -> Data {
        guard let scope = scope as? ConversationMediaScope, scope.original === original else { throw MediaError.expired }
        try scope.check(); try request.upload?.validate()
        let input = try ConversationFeatureRequest(method: request.method, path: request.path, body: request.jsonBody,
            upload: request.upload?.url, uploadBytes: request.upload?.byteLength, expectedStatus: request.expectedStatus)
        do { return try await session.conversationData(.feature(input), scope: original) }
        catch let error as ConversationFeatureFailure { throw MediaError.response(error.status, nil) }
    }
}
struct ConversationMediaJournal: MediaJournal {
    let original: ConversationScope
    let journal: any ConversationFeatureJournal
    func save(_ pending: PendingMedia, scope: any MediaScope) throws {
        guard let scope = scope as? ConversationMediaScope, scope.original === original else { throw MediaError.expired }
        try journal.put(.media, id: pending.assetId, value: JSONEncoder().encode(pending))
    }
    func remove(_ assetID: String, scope: any MediaScope) throws {
        guard let scope = scope as? ConversationMediaScope, scope.original === original else { throw MediaError.expired }
        try journal.remove(.media, id: assetID)
    }
}
@MainActor final class ConversationActionJournal: ActionJournal, ScrollAnchorStore {
    let original: ConversationScope
    let actionScope: ActionScope
    let journal: any ConversationFeatureJournal
    init(original: ConversationScope, actionScope: ActionScope, journal: any ConversationFeatureJournal) {
        self.original = original; self.actionScope = actionScope; self.journal = journal
    }
    func records() throws -> [ActionRecord] {
        try (journal.records(.actions) + journal.records(.moderation)).map {
            let record = try JSONDecoder().decode(ActionRecord.self, from: $0)
            guard actionID(record.id), record.selection.valid, record.selection.scope.partition.prefix(3) == actionScope.partition.prefix(3) else { throw MessageActionError.invalidResponse }
            return record
        }
    }
    func put(_ record: ActionRecord) throws {
        guard actionID(record.id), record.selection.valid, record.selection.scope.partition.prefix(3) == actionScope.partition.prefix(3) else { throw MessageActionError.stale }
        try journal.put(record.action == .blockActor ? .moderation : .actions, id: record.id, value: JSONEncoder().encode(record))
    }
    func load(_ scope: ActionScope) throws -> ScrollAnchor? {
        guard scope == actionScope else { throw MessageActionError.stale }
        guard let data = try journal.records(.viewport).first else { return nil }
        let value = try JSONDecoder().decode(ScrollAnchor.self, from: data)
        guard actionID(value.messageId), value.offset >= 0 else { throw MessageActionError.invalidResponse }; return value
    }
    func save(_ scope: ActionScope, anchor: ScrollAnchor?) throws {
        guard scope == actionScope else { throw MessageActionError.stale }
        if let anchor { try journal.put(.viewport, id: original.room.id, value: JSONEncoder().encode(anchor)) }
        else { try journal.remove(.viewport, id: original.room.id) }
    }
}
struct ConversationActionTransport: MessageActionTransport {
    let session: AppSession
    let original: ConversationScope
    let actionScope: ActionScope
    func execute(_ request: ActionRequest, permit: ActionPermit) async throws -> ActionResult {
        guard permit.record.selection.scope == actionScope else { throw MessageActionError.stale }
        let input = try ConversationFeatureRequest(method: request.method, path: request.path, body: request.body,
            expectedStatus: request.successStatus, query: request.query, admit: { try permit.claim() })
        do {
            let data = try await session.conversationData(.feature(input), scope: original)
            return MessageActionWire.result(permit.record.action, status: request.successStatus, data: data)
        } catch let error as ConversationFeatureFailure {
            return MessageActionWire.result(permit.record.action, status: error.status, data: error.data)
        }
    }
}

@MainActor @Observable final class ConversationFeatureModel {
    let conversation: ConversationScreenModel
    let media: MediaClient
    let mediaScope: ConversationMediaScope
    let actions: MessageActionState
    let readPosition: MessageReadPosition
    let actionScope: ActionScope
    private let session: AppSession
    private let journal: any ConversationFeatureJournal
    private let actionJournal: ConversationActionJournal
    private let runner: MessageActionRunner
    private let storage: any ConversationFeatureStoring
    private let uploader: MediaUpload
    private var actionTask: Task<Void, Never>?
    private var readTask: Task<Void, Never>?
    private(set) var revision = 0
    private(set) var busy = false
    private(set) var mediaBusy = false
    private(set) var error: String?
    private(set) var pendingMedia: [PendingMedia] = []
    private(set) var readyMedia: (PendingMedia, MediaReceipt)?
    private(set) var reactions: MessageReactions?
    private(set) var viewport = MessageViewport()
    private(set) var move: ViewportMove = .none
    private var knownIDs: Set<String> = []
    private var selectedProjection: ConversationMessage?
    var token: ActionViewToken? { _ = revision; return actions.capture() }
    var record: ActionRecord? { _ = revision; return actions.presentation }
    var active: Bool { conversation.active }
    init(conversation: ConversationScreenModel, session: AppSession, environment: String, accountID: String) throws {
        guard let storage = conversation.coordinator as? any ConversationFeatureStoring else { throw ConversationError.persistence }
        let original = conversation.scope
        let actionScope = ActionScope(environment: environment, accountId: accountID, sessionEpoch: original.account.clientScope.uuidString.lowercased(),
            roomId: original.room.id, actorId: original.room.actorId, membershipScope: original.room.membershipScope,
            authorizationRevision: original.room.authorizationRevision, cacheEpoch: original.cacheID)
        guard actionScope.valid else { throw ConversationError.invalidResponse }
        self.conversation = conversation; self.session = session; self.storage = storage; self.journal = storage.localFeatures
        self.actionScope = actionScope
        mediaScope = ConversationMediaScope(original: original)
        media = MediaClient(transport: ConversationMediaTransport(session: session, original: original), scope: mediaScope)
        uploader = MediaUpload(client: media, journal: ConversationMediaJournal(original: original, journal: storage.localFeatures))
        let actionJournal = ConversationActionJournal(original: original, actionScope: actionScope, journal: storage.localFeatures)
        self.actionJournal = actionJournal
        actions = MessageActionState(journal: actionJournal)
        runner = MessageActionRunner(state: actions, transport: ConversationActionTransport(session: session, original: original, actionScope: actionScope))
        readPosition = MessageReadPosition(anchors: actionJournal); readPosition.select(actionScope)
    }
    func load() async {
        do {
            try mediaScope.check()
            pendingMedia = try journal.records(.media).map { data in
                let pending = try JSONDecoder().decode(PendingMedia.self, from: data)
                _ = try mediaID(pending.assetId); guard pending.kind != .avatar else { throw MediaError.invalid }; return pending
            }
            await refreshRead()
        } catch { failure(error) }
    }
    func projectionChanged(_ listing: ConversationListing, history: Bool) {
        guard active else { close(); return }
        let ids = Set(listing.messages.map(\.id))
        if let selectedProjection {
            let current = listing.messages.first { $0.id == selectedProjection.id }
            if current != selectedProjection {
                actions.reset(); self.selectedProjection = nil; reactions = nil; revision += 1
            }
        }
        do {
            for id in knownIDs.subtracting(ids) { try readPosition.deleted(id); viewport.deleted(id) }
            if knownIDs.isEmpty, let token = readPosition.capture() {
                move = viewport.initialize(restored: try readPosition.restoreAnchor(token, currentlyReadable: ids))
            } else if history { move = viewport.olderPageCommitted() }
            else { move = try viewport.incomingCommitted(ids.subtracting(knownIDs)) }
            knownIDs = ids
        } catch { failure(error) }
    }
    func observeVisible(_ id: String?, atLatest: Bool) {
        guard active else { close(); return }
        let anchor = id.map { ScrollAnchor(messageId: $0, offset: 0) }
        viewport.observed(anchor: anchor, atLatest: atLatest)
        if let anchor, let token = readPosition.capture() {
            do { try readPosition.saveAnchor(token, anchor: anchor, currentlyReadable: knownIDs) } catch { failure(error) }
        }
    }
    // Called only by a visible row callback, never by restored anchor or queued command.
    func displayed(_ id: String) {
        guard active, knownIDs.contains(id), readTask == nil, let token = readPosition.capture() else { return }
        do {
            guard let permit = try readPosition.displayed(token, messageId: id) else { return }
            readTask = Task {
                defer { self.readTask = nil }
                do {
                    let request = try permit.request()
                    let data = try await self.perform(request, admit: { try permit.claim() })
                    _ = try self.readPosition.finish(permit, acknowledged: true, savedMessageId: MessageReadWire.saved(data))
                } catch {
                    _ = try? self.readPosition.finish(permit, acknowledged: false, savedMessageId: nil)
                    self.failure(error) // No automatic PUT replay or reporting old rows after fresh GET.
                }
            }
        } catch { failure(error) }
    }
    func refreshRead() async {
        guard readPosition.needsRefresh, let token = readPosition.capture() else { return }
        do { _ = try readPosition.accept(token, snapshot: MessageReadWire.snapshot(try await perform(MessageReadWire.get(actionScope)))) }
        catch { failure(error) }
    }
    func latest() { move = viewport.showLatest() }
    func consumedMove() { move = .none }
    func select(_ message: ConversationMessage) {
        guard active, conversation.listing?.messages.contains(message) == true else { return }
        do {
            let kind: String
            switch message.content { case .text: kind = "TEXT"; case .photo: kind = "PHOTO"; case .video: kind = "VIDEO"; case .sticker: kind = "STICKER" }
            let value = ActionSelection(scope: actionScope, messageId: message.id, version: message.version.rawValue,
                hints: ActionHints(delete: message.allowedActions.delete, publish: message.allowedActions.publish), contentKind: kind,
                anonymous: message.author.actorID == nil, visibleActorId: message.author.actorID)
            try actions.select(value); selectedProjection = message; reactions = nil; revision += 1
        } catch { failure(error) }
    }
    func dismissActions() { actions.reset(); selectedProjection = nil; reactions = nil; revision += 1 }
    func action(_ token: ActionViewToken, _ action: MessageAction, emoji: String? = nil, reason: ReportReason? = nil) {
        guard active, !busy else { return }
        do {
            if action == .blockActor {
                try journal.put(.blockRooms, id: conversation.scope.room.id, value: JSONEncoder().encode(BlockRoomReference(id: conversation.scope.room.id)))
            }
            let permit = try actions.begin(token, action: action, emoji: emoji, reportReason: reason)
            busy = true; revision += 1; error = nil
            actionTask = Task {
                defer { self.busy = false; self.revision += 1; self.actionTask = nil }
                do { try await self.apply(self.runner.execute(permit)) }
                catch { self.failure(error) }
            }
        } catch { failure(error) }
    }
    func refreshAction(_ token: ActionViewToken) async {
        guard active, !busy, actions.admits(token) else { return }
        busy = true; defer { busy = false; revision += 1 }
        do {
            if let record = actions.presentation, record.action == .report, record.phase == .unknown {
                let data = try await perform(ModerationWire.recoverReport(record))
                _ = try actions.reportStatus(token, recordId: record.id, receipt: ModerationWire.receipt(data))
            } else if let record = actions.presentation, record.action == .publish, let id = record.receiptId {
                let data = try await perform(MessageActionWire.publication(actionScope, id: id))
                try await apply(actions.publicationStatus(token, recordId: record.id, result: MessageActionWire.publicationResult(data)))
            }
            let data = try await perform(MessageActionWire.reactions(token.selection))
            if actions.admits(token) { reactions = try MessageActionWire.reactionResult(data) }
            await conversation.refresh()
        } catch { failure(error) }
    }
    private func apply(_ effect: ActionEffect?) async throws {
        guard active else { throw MessageActionError.stale }
        switch effect {
        case .accessBlocked(let selection):
            try await storage.blockProjection(selection.messageId); dismissActions(); await conversation.refresh()
        case .resetRoom:
            conversation.scope.invalidate(); close()
        case .refresh: await conversation.refresh()
        case nil: break
        }
    }
    func upload(_ file: MediaFile) async throws {
        guard active, !mediaBusy, readyMedia == nil else { file.remove(); throw MediaError.unavailable }
        mediaBusy = true; error = nil; defer { mediaBusy = false }
        do {
            let receipt = try await uploader.start(file); try mediaScope.check()
            readyMedia = (PendingMedia(assetId: receipt.assetId, kind: file.kind), receipt)
            pendingMedia = try journal.records(.media).map { try JSONDecoder().decode(PendingMedia.self, from: $0) }
        } catch { failure(error); throw error }
    }
    func recover(_ pending: PendingMedia) async {
        guard active, !mediaBusy, readyMedia == nil, pendingMedia.contains(pending) else { return }
        mediaBusy = true; error = nil; defer { mediaBusy = false }
        do { readyMedia = (pending, try await uploader.recover(pending)) }
        catch { failure(error) }
    }
    func discardMedia() { readyMedia = nil } // Server grant lifetime is unchanged; journal retained for recovery.
    func sendReadyMedia() async {
        guard let (pending, receipt) = readyMedia else { return }
        do {
            guard receipt.status == .ready else { throw MediaError.processing }
            let command = try await conversation.sendAttachment(OutgoingAttachment(type: pending.kind.rawValue, assetIds: [receipt.assetId]))
            if try await conversation.coordinator.containsCommand(command.id) {
                try await uploader.acknowledged(pending.assetId); readyMedia = nil; pendingMedia.removeAll { $0.assetId == pending.assetId }
            }
        } catch { failure(error) }
    }
    func sendSticker(_ sticker: MediaSticker) async throws { _ = try await conversation.sendAttachment(OutgoingAttachment(type: "STICKER", stickerId: sticker.id)) }
    private func perform(_ request: ActionRequest, admit: @escaping @Sendable () throws -> Void = {}) async throws -> Data {
        try await session.conversationData(.feature(ConversationFeatureRequest(method: request.method, path: request.path, body: request.body,
            expectedStatus: request.successStatus, query: request.query, admit: admit)), scope: conversation.scope)
    }
    func close() { actions.reset(); readPosition.select(nil); viewport.reset(); selectedProjection = nil; readyMedia = nil; pendingMedia = []; reactions = nil; revision += 1 }
    private func failure(_ failure: any Error) {
        if !active { close() }
        error = (failure as? LocalizedError)?.errorDescription ?? "작업을 완료하지 못했어요. 현재 상태를 다시 확인해 주세요."
    }
}
