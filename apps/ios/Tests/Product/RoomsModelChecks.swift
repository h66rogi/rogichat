import Foundation

private actor ModelRoomsCoordinator: RoomsCoordinating {
    var listing: RoomsListing
    private var pending: CheckedContinuation<RoomCommandResult, any Error>?
    private var waiter: CheckedContinuation<Void, Never>?
    private(set) var commandCount = 0
    private(set) var refreshCount = 0
    private var refreshFails = false
    init(_ listing: RoomsListing) { self.listing = listing }
    func refresh() async throws -> RoomsListing { refreshCount += 1; if refreshFails { throw RoomsError.connection }; return listing }
    func failRefresh(_ value: Bool) { refreshFails = value }
    func loadMore() async throws -> RoomsListing { listing }
    func command(_ intent: RoomCommandIntent) async throws -> RoomCommandResult {
        commandCount += 1
        return try await withCheckedThrowingContinuation { pending = $0; waiter?.resume(); waiter = nil }
    }
    func wait() async { if pending != nil { return }; await withCheckedContinuation { waiter = $0 } }
    func fail(_ outcome: RoomCommandOutcome) { pending?.resume(throwing: RoomCommandReconciliationError(outcome: outcome)); pending = nil }
    func finish() { pending?.resume(returning: RoomCommandResult(listing: listing, outcome: .acknowledged)); pending = nil }
    func configure(_ value: RoomsListing) { listing = value }
}
@main struct RoomsModelChecks {
    static let roomID = "00000000-0000-4000-8000-000000000001"
    static let actorID = "00000000-0000-4000-8000-000000000002"
    static func token(_ byte: UInt8 = 1) -> String { Data(repeating: byte, count: 32).base64EncodedString().replacingOccurrences(of: "+", with: "-").replacingOccurrences(of: "/", with: "_").replacingOccurrences(of: "=", with: "") }
    static func listing() throws -> RoomsListing {
        let object: [String: Any] = ["roomId": roomID, "name": "방", "mode": "FAN", "actorId": actorID, "role": "FAN", "membershipScope": token(), "authorizationRevision": token(2)]
        let room = try JSONDecoder().decode(MembershipRoom.self, from: JSONSerialization.data(withJSONObject: object))
        return RoomsListing(memberships: [room], discovery: [], membershipConfirmed: true, discoveryComplete: true, cycle: UUID().uuidString)
    }
    @MainActor static func waitForFinish(_ model: RoomsScreenModel) async throws {
        let deadline = Date().addingTimeInterval(3)
        while model.commandAction != nil {
            precondition(Date() < deadline, "Owned model command failed to complete")
            try await Task.sleep(for: .milliseconds(1))
        }
    }
    static func check(_ condition: Bool) { precondition(condition) }
    @MainActor static func main() async throws {
        let pending = try JSONDecoder().decode(DiscoveredRoom.self, from: JSONSerialization.data(withJSONObject: ["roomId": roomID, "name": "후로기", "mode": "FAN", "isDefault": true, "availability": "OWNER_PENDING"]))
        let pendingListing = RoomsListing(memberships: [], discovery: [pending], membershipConfirmed: true, discoveryComplete: true, cycle: UUID().uuidString)
        let pendingScope = try RoomsScope(partition: token(), clientScope: UUID(), expiresAt: Date().addingTimeInterval(3600))
        let pendingCoordinator = ModelRoomsCoordinator(pendingListing)
        let pendingOwner = RoomsFeatureOwner()
        let pendingModel = pendingOwner.model(scope: pendingScope) { RoomsScreenModel(repository: pendingCoordinator, scope: pendingScope) }
        await pendingModel.refresh()
        check(pendingModel.selection(roomID: roomID, roomName: "후로기", displayedCycle: pendingListing.cycle, action: .join, membership: nil) == nil)
        for outcome in [RoomCommandOutcome.acknowledged, .unknown] {
            let scope = try RoomsScope(partition: token(), clientScope: UUID(), expiresAt: Date().addingTimeInterval(3600))
            let preserved = try listing(); let coordinator = ModelRoomsCoordinator(preserved)
            let owner = RoomsFeatureOwner()
            let model = owner.model(scope: scope) { RoomsScreenModel(repository: coordinator, scope: scope) }
            await model.refresh()
            precondition(model.canAct && model.listing?.membershipConfirmed == true)
            let selected = model.selection(roomID: roomID, roomName: "방", displayedCycle: preserved.cycle, action: .leave, membership: token())!
            model.submit(selected)
            precondition(!model.canAct) // Before the newly created Task can run.
            await coordinator.wait()
            let reattached = owner.model(scope: scope) { preconditionFailure("Screen recreation replaced its owner") }
            precondition(reattached === model && !reattached.canAct)
            await reattached.refresh(); reattached.submit(selected)
            check(await coordinator.commandCount == 1)
            check(await coordinator.refreshCount == 1)
            await coordinator.fail(outcome)
            try await waitForFinish(model)
            precondition(model.listing?.membershipConfirmed == true && !model.canAct && model.error != nil)
            let afterError = owner.model(scope: scope) { preconditionFailure("Error recreated coordinator") }
            precondition(afterError === model && !afterError.canAct)
            afterError.submit(selected)
            check(await coordinator.commandCount == 1)
            let fresh = try listing(); await coordinator.configure(fresh)
            await model.refresh()
            precondition(model.canAct && model.listing?.cycle == fresh.cycle)
            if outcome == .unknown {
                precondition(model.notice == nil)
                await coordinator.failRefresh(true); await model.refresh()
                let afterReadFailure = owner.model(scope: scope) { preconditionFailure("Read error recreated owner") }
                precondition(afterReadFailure === model && !model.canAct && model.error != nil)
                precondition(model.notice == nil)
                check(await coordinator.commandCount == 1)
                await coordinator.failRefresh(false); await model.refresh()
            }
            precondition(model.selection(roomID: roomID, roomName: "방", displayedCycle: preserved.cycle, action: .leave, membership: token()) == nil)
            model.submit(selected) // An old presenting alert never rebinds to the new cycle.
            check(await coordinator.commandCount == 1)
            let next = model.selection(roomID: roomID, roomName: "방", displayedCycle: fresh.cycle, action: .leave, membership: token())!
            model.submit(next); await coordinator.wait()
            scope.invalidate(); await coordinator.finish()
            try await waitForFinish(model)
            precondition(!model.canAct)
            check(await coordinator.commandCount == 2)
            let newScope = try RoomsScope(partition: token(3), clientScope: UUID(), expiresAt: Date().addingTimeInterval(3600))
            let newModel = owner.model(scope: newScope) { RoomsScreenModel(repository: coordinator, scope: newScope) }
            precondition(newModel !== model && !newModel.canAct && newModel.notice == nil)
        }
        print("iOS rooms model: owned task/reattach, preserved-list authority closed, automatic unknown recovery, old rendered/alert cycle and scope invalidation passed")
    }
}
