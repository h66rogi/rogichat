import Foundation
import SwiftUI
import Observation
import RogichatRooms

@MainActor private final class AccountBlockJournal: BlockJournal, ActionJournal {
    let database: RoomsDatabase
    let scope: BlockScope
    init(database: RoomsDatabase, scope: BlockScope) { self.database = database; self.scope = scope }
    func records() throws -> [UnblockRecord] {
        try database.accountRecords(.unblocks, room: scope.roomId).map {
            let record = try JSONDecoder().decode(UnblockRecord.self, from: $0)
            guard actionID(record.id), record.scope.valid, record.scope.partition == scope.partition else { throw MessageActionError.invalidResponse }; return record
        }
    }
    func records() throws -> [ActionRecord] {
        try database.accountRecords(.moderation, room: scope.roomId).map {
            let record = try JSONDecoder().decode(ActionRecord.self, from: $0)
            guard record.selection.valid, record.selection.scope.partition.prefix(3) == scope.partition[...], record.action == .blockActor else { throw MessageActionError.invalidResponse }; return record
        }
    }
    func put(_ record: UnblockRecord) throws {
        guard record.scope.partition == scope.partition else { throw MessageActionError.stale }
        try database.putAccountFeature(.unblocks, room: scope.roomId, id: record.id, value: JSONEncoder().encode(record))
    }
    func put(_ record: ActionRecord) throws {
        guard record.selection.scope.partition.prefix(3) == scope.partition[...], record.action == .blockActor else { throw MessageActionError.stale }
        try database.putAccountFeature(.moderation, room: scope.roomId, id: record.id, value: JSONEncoder().encode(record))
    }
}
@MainActor @Observable final class OwnBlocksModel {
    let room: OwnBlockRoom
    private let session: AppSession
    private let account: RoomsScope
    private let state: ActorBlocksState
    private let onAuthorityChanged: () -> Void
    private(set) var revision = 0
    private(set) var busy = false
    private(set) var error: String?
    var token: BlockViewToken? { _ = revision; return state.capture() }
    var blocks: [BlockedActor] { _ = revision; return state.blocks }
    var complete: Bool { _ = revision; return state.complete }
    var failed: Bool { _ = revision; return state.failed }
    var unknown: Set<String> { (try? state.unknownActors()) ?? [] }
    var outcome: UnblockOutcome? { _ = revision; return state.lastOutcome }
    init(room: OwnBlockRoom, accountID: String, environment: String, session: AppSession, database: RoomsDatabase, onAuthorityChanged: @escaping () -> Void) throws {
        self.room = room; self.session = session; account = database.scope; self.onAuthorityChanged = onAuthorityChanged
        let scope = BlockScope(environment: environment, accountId: accountID, sessionEpoch: database.scope.clientScope.uuidString.lowercased(), roomId: room.id, viewEpoch: UUID().uuidString.lowercased())
        let journal = AccountBlockJournal(database: database, scope: scope)
        state = ActorBlocksState(journal: journal, actionJournal: journal); try state.select(scope)
    }
    func load(more: Bool = false) async {
        guard !busy else { return }; busy = true; error = nil; defer { busy = false; revision += 1 }
        var token: BlockPageToken?
        do {
            token = try more ? state.more() : state.refresh()
            guard let token else { return }
            let data = try await perform(ActorBlocksWire.list(token))
            let reset = try state.accept(token, page: ActorBlocksWire.page(data))
            if reset != nil { onAuthorityChanged() }
        } catch { if let token { state.fail(token) }; self.error = "현재 차단 목록을 확인하지 못했어요. 다시 시도해 주세요." }
    }
    func unblock(_ token: BlockViewToken, actor: String) {
        guard !busy else { return }
        do {
            let permit = try state.unblock(token, actorId: actor); busy = true; revision += 1; error = nil
            Task {
                defer { busy = false; revision += 1 }
                let result: UnblockOutcome
                do { let request = permit.request(); let data = try await perform(request, admit: { try permit.claim() }); result = ActorBlocksWire.result(permit, status: request.successStatus, data: data) }
                catch let error as ConversationFeatureFailure { result = ActorBlocksWire.result(permit, status: error.status, data: error.data) }
                catch { result = .unknown }
                do { if try state.finish(permit, outcome: result) != nil { onAuthorityChanged() } }
                catch { self.error = "기기에 차단 해제 결과를 기록하지 못했어요." }
            }
        } catch { self.error = "현재 상태를 확인한 뒤 다시 선택해 주세요." }
    }
    private func perform(_ request: ActionRequest, admit: @escaping @Sendable () throws -> Void = {}) async throws -> Data {
        try await session.accountFeatureData(ConversationFeatureRequest(method: request.method, path: request.path, body: request.body,
            expectedStatus: request.successStatus, query: request.query, admit: admit), scope: account)
    }
}
struct OwnBlocksScreen: View {
    let session: AppSession
    let storage: RoomsStorage
    let scope: RoomsScope
    let accountID: String
    let environment: String
    let onAuthorityChanged: () -> Void
    @State private var listing: OwnBlockRoomsModel
    @State private var selected: OwnBlocksModel?
    @State private var failure: String?
    init(session: AppSession, storage: RoomsStorage, scope: RoomsScope, accountID: String, environment: String, onAuthorityChanged: @escaping () -> Void) {
        self.session = session; self.storage = storage; self.scope = scope; self.accountID = accountID; self.environment = environment; self.onAuthorityChanged = onAuthorityChanged
        _listing = State(initialValue: OwnBlockRoomsModel(scope: scope) { cursor in
            try await session.accountFeatureData(ConversationFeatureRequest(method: "GET", path: "blocked-rooms", body: nil, expectedStatus: 200,
                query: cursor.map { ["cursor": $0] } ?? [:]), scope: scope)
        })
    }
    var body: some View {
        List {
            if listing.busy { ProgressView("차단된 대화방 확인 중") }
            if listing.complete, listing.rooms.isEmpty { Text("차단한 사용자가 있는 대화방이 없어요.").foregroundStyle(.secondary) }
            ForEach(listing.rooms) { room in Button(room.label) {
                do { selected = try OwnBlocksModel(room: room, accountID: accountID, environment: environment, session: session, database: storage.open(scope: scope), onAuthorityChanged: onAuthorityChanged) }
                catch { failure = "기기의 차단 기록을 읽지 못했어요." }
            } }
            if let error = listing.error { Text(error).foregroundStyle(.secondary) }
            if let failure { Text(failure).foregroundStyle(.secondary) }
            Button("목록 다시 확인") { selected = nil; failure = nil; Task { await listing.refresh() } }.disabled(listing.busy)
        }.navigationTitle("차단 관리")
            .task { await listing.refresh() }
            .onDisappear { listing.close() }
            .sheet(isPresented: Binding(get: { selected != nil }, set: { if !$0 { selected = nil } })) {
                if let model = selected, let token = model.token {
                    NavigationStack { ScrollView {
                        ActorBlocksPanel(token: token, blocks: model.blocks, complete: model.complete, busy: model.busy, failed: model.failed,
                            unknownActors: model.unknown, lastOutcome: model.outcome, onRefresh: { Task { await model.load() } },
                            onMore: { Task { await model.load(more: true) } }, onUnblock: { model.unblock($0, actor: $1) }).padding()
                        if let error = model.error { Text(error).font(.footnote).padding() }
                    }.navigationTitle(model.room.label).toolbar { ToolbarItem(placement: .cancellationAction) { Button("닫기") { selected = nil } } }
                        .task { await model.load() }
                    }
                }
            }
    }
}
