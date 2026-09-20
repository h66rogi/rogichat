import Foundation

// Protocol/client injection adapted from Meloming NotificationRepository.
// The generation staging, persistence, and scope fences are Rogichat-specific.
public protocol RoomsFetching: Sendable {
    func discovery(after: String?, scope: RoomsScope) async throws -> DiscoveryPage
    func manifest(_ request: ManifestRequest, scope: RoomsScope) async throws -> MembershipPage
    func command(_ intent: RoomCommandIntent) async throws
}
public extension RoomsFetching {
    func command(_ intent: RoomCommandIntent) async throws { throw RoomsError.unavailable }
}
// Retained for an account scope by the product composition. Screen cancellation
// only removes an observer; it cannot release the command ticket or replay HTTP.
public actor RoomsRepository: RoomsCoordinating {
    private let remote: any RoomsFetching
    private let storage: RoomsStorage
    private let scope: RoomsScope
    private var busy = false
    private var revision = UUID()
    private var discoveryRevision: String?
    private var authorityCycle: String?
    private var commandTask: Task<RoomCommandResult, any Error>?
    public init(remote: any RoomsFetching, storage: RoomsStorage, scope: RoomsScope) {
        self.remote = remote; self.storage = storage; self.scope = scope
    }
    public func refresh() async throws -> RoomsListing {
        guard commandTask == nil else { throw RoomCommandError.inProgress }
        // A refresh supersedes previous read IO, never an owned command.
        revision = UUID(); let ticket = revision; busy = true; authorityCycle = nil
        defer { if ticket == revision { busy = false } }
        try scope.check()
        let db = try storage.open(scope: scope)
        let discovery = try db.beginDiscovery(); discoveryRevision = discovery
        let request = try db.beginManifest()
        let first = try await remote.discovery(after: nil, scope: scope)
        try current(ticket)
        try db.discoveryPage(first, revision: discovery, after: nil)
        try await completeManifest(request, db: db, ticket: ticket)
        let listing = try db.listing(); try current(ticket)
        authorityCycle = listing.cycle
        return listing
    }
    public func loadMore() async throws -> RoomsListing {
        guard commandTask == nil else { throw RoomCommandError.inProgress }
        guard !busy, let discoveryRevision, authorityCycle != nil else { throw RoomsError.incomplete }
        busy = true; let ticket = revision
        defer { if ticket == revision { busy = false } }
        try current(ticket)
        let db = try storage.open(scope: scope)
        guard let after = try db.discoveryNext(revision: discoveryRevision) else { return try db.listing() }
        let page = try await remote.discovery(after: after, scope: scope)
        try current(ticket)
        try db.discoveryPage(page, revision: discoveryRevision, after: after)
        return try db.listing()
    }
    public func command(_ intent: RoomCommandIntent) async throws -> RoomCommandResult {
        guard commandTask == nil, !busy else { throw RoomCommandError.inProgress }
        guard intent.scope === scope, authorityCycle == intent.cycle else { throw RoomCommandError.confirmationChanged }
        try scope.check()
        revision = UUID(); let ticket = revision; busy = true; authorityCycle = nil
        let db: RoomsDatabase
        let request: ManifestRequest
        do {
            db = try storage.open(scope: scope)
            request = try db.prepareCommand(intent) // Actual durable COMMIT precedes even the HTTP task creation.
        } catch { busy = false; throw error }
        let operation = Task { try await self.runCommand(intent, request: request, db: db, ticket: ticket) }
        commandTask = operation
        return try await operation.value
    }
    private func runCommand(_ intent: RoomCommandIntent, request: ManifestRequest, db: RoomsDatabase, ticket: UUID) async throws -> RoomCommandResult {
        defer { if ticket == revision { commandTask = nil; busy = false } }
        try current(ticket)
        let outcome: RoomCommandOutcome
        do { try await remote.command(intent); try current(ticket); outcome = .acknowledged }
        catch {
            try current(ticket) // Auth/expiry/logout invalidation closes the scope; no new-account reconciliation.
            outcome = (error as? RoomCommandError).map(RoomCommandOutcome.rejected) ?? .unknown
        }
        do {
            // Reconcile the entire account manifest first; join receipt M/A only
            // describes one server acknowledgement, not current global authority.
            try await completeManifest(request, db: db, ticket: ticket)
            let discovery = try db.beginDiscovery(); discoveryRevision = discovery
            let page = try await remote.discovery(after: nil, scope: scope)
            try current(ticket)
            try db.discoveryPage(page, revision: discovery, after: nil)
            let listing = try db.listing(); try current(ticket)
            authorityCycle = listing.cycle
            return RoomCommandResult(listing: listing, outcome: outcome)
        } catch {
            try current(ticket)
            throw RoomCommandReconciliationError(outcome: outcome)
        }
    }
    private func completeManifest(_ initial: ManifestRequest, db: RoomsDatabase, ticket: UUID) async throws {
        var request = initial; var resets = 0; var pages = 0
        while true {
            try current(ticket)
            let page = try await remote.manifest(request, scope: scope)
            try current(ticket)
            pages += 1
            guard pages <= 10_001 else { throw RoomsError.incomplete }
            if page.resetRequired { resets += 1; guard resets <= 2 else { throw RoomsError.incomplete } }
            guard let next = try db.manifestPage(page, request: request) else { return }
            request = next
        }
    }
    private func current(_ ticket: UUID) throws {
        try scope.check()
        guard ticket == revision else { throw RoomsError.staleScope }
    }
}
