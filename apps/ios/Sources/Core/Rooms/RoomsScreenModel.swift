import Foundation
import Observation
#if canImport(RogichatRooms)
import RogichatRooms
#endif

// The product root retains this owner, not the lifetime of a List or alert.
// Loading(previous:) is adapted from Meloming; command authority is separate.
@MainActor @Observable
final class RoomsScreenModel {
    private(set) var state: Loadable<RoomsListing> = .idle
    var listing: RoomsListing? { state.value }
    var loading: Bool { state.isLoading }
    private(set) var loadingMore = false
    private(set) var error: String?
    private(set) var notice: String?
    private(set) var commandAction: RoomCommandAction?
    private(set) var actions = RoomsActionState()
    private var revision = UUID()
    private let repository: any RoomsCoordinating
    private let scope: RoomsScope
    private var commandTask: Task<Void, Never>?
    init(repository: any RoomsCoordinating, scope: RoomsScope) { self.repository = repository; self.scope = scope }
    var canAct: Bool {
        actions.permits(cycle: listing?.cycle) && commandTask == nil && !loading && !loadingMore && (try? scope.check()) != nil
    }
    var needsConfirmation: Bool { listing != nil && !actions.permits(cycle: listing?.cycle) && !loading && commandTask == nil }
    func refreshIfNeeded() async {
        if listing == nil, error == nil { await refresh() }
        else if needsConfirmation, error == nil { await refresh() }
    }
    func refresh() async {
        guard commandTask == nil else { return }
        revision = UUID(); let ticket = revision
        let previous = state.value
        state = .loading(previous: previous); error = nil; actions.close(working: true)
        defer {
            if revision == ticket, state.isLoading { state = previous.map(Loadable.loaded) ?? .idle; actions.close(working: false) }
        }
        do {
            let value = try await repository.refresh()
            try scope.check()
            guard ticket == revision, !Task.isCancelled else { return }
            state = .loaded(value)
            if let cycle = value.cycle { actions.confirmed(cycle: cycle) }
            else { actions.close(working: false) }
        } catch {
            guard ticket == revision, !Task.isCancelled else { return }
            self.error = Self.message(error); actions.close(working: false)
            state = previous.map(Loadable.loaded) ?? .failed(error)
        }
    }
    func loadMore() async {
        guard canAct else { return }
        loadingMore = true; let ticket = revision; error = nil
        defer { loadingMore = false }
        do {
            let value = try await repository.loadMore()
            try scope.check()
            guard ticket == revision, !Task.isCancelled else { return }
            state = .loaded(value)
        } catch {
            guard ticket == revision, !Task.isCancelled else { return }
            self.error = Self.message(error)
        }
    }
    func selection(roomID: String, roomName: String, displayedCycle: String?, action: RoomCommandAction, membership: String?) -> RoomCommandIntent? {
        guard canAct, let cycle = displayedCycle, actions.permits(cycle: cycle) else { return nil }
        return try? RoomCommandIntent(scope: scope, roomID: roomID, roomName: roomName, action: action, cycle: cycle, membershipScope: membership)
    }
    // Synchronous reservation precedes Task creation. A presenting alert keeps
    // this exact intent; it never looks up a new current account after approval.
    func submit(_ intent: RoomCommandIntent) {
        guard canAct, intent.scope === scope, actions.permits(cycle: intent.cycle) else {
            error = RoomCommandError.confirmationChanged.errorDescription; return
        }
        actions.close(working: true); revision = UUID(); let ticket = revision
        commandAction = intent.action; error = nil
        commandTask = Task { await self.finishCommand(intent, ticket: ticket) }
    }
    private func finishCommand(_ intent: RoomCommandIntent, ticket: UUID) async {
        defer { if revision == ticket { commandAction = nil; commandTask = nil } }
        do {
            let result = try await repository.command(intent)
            try scope.check()
            guard revision == ticket else { return }
            state = .loaded(result.listing)
            if let cycle = result.listing.cycle { actions.confirmed(cycle: cycle) }
            else { actions.close(working: false) }
            if let message = result.outcome.notice { notice = message }
        } catch {
            guard revision == ticket else { return }
            actions.close(working: false)
            self.error = Self.message(error)
            if let failure = error as? RoomCommandReconciliationError {
                if failure.outcome == .unknown { notice = "앞선 요청의 처리 결과는 확인하지 못했어요. 참여 상태를 다시 확인해 주세요." }
                else if let message = failure.outcome.notice { notice = message }
            }
        }
    }
    private static func message(_ error: any Error) -> String {
        (error as? RoomCommandReconciliationError)?.errorDescription ?? (error as? RoomCommandError)?.errorDescription ??
        (error as? RoomsError)?.errorDescription ?? (error as? ProductError)?.errorDescription ?? "참여 상태를 확인하지 못했어요. 다시 확인해 주세요."
    }
}
@MainActor
final class RoomsFeatureOwner {
    private var current: (scope: RoomsScope, model: RoomsScreenModel)?
    func model(scope: RoomsScope, make: () -> RoomsScreenModel) -> RoomsScreenModel {
        if let current, current.scope === scope { return current.model }
        let model = make()
        current = (scope, model)
        return model
    }
    func clear() { current = nil }
}
