import Foundation

// Protocol/client injection adapted from Meloming NotificationRepository.
// The generation staging, persistence, and scope fences are Rogichat-specific.
public protocol RoomsFetching: Sendable {
    func discovery(after: String?, scope: RoomsScope) async throws -> DiscoveryPage
    func manifest(_ request: ManifestRequest, scope: RoomsScope) async throws -> MembershipPage
}
public actor RoomsRepository {
    private let remote: any RoomsFetching
    private let storage: RoomsStorage
    private let scope: RoomsScope
    private var busy = false
    private var revision = UUID()
    private var discoveryRevision: String?
    public init(remote: any RoomsFetching, storage: RoomsStorage, scope: RoomsScope) {
        self.remote = remote; self.storage = storage; self.scope = scope
    }
    public func refresh() async throws -> RoomsListing {
        // A refresh supersedes previous IO, including a loading-more request.
        revision = UUID(); let ticket = revision; busy = true
        defer { if ticket == revision { busy = false } }
        try scope.check()
        let db = try storage.open(scope: scope)
        let discovery = try db.beginDiscovery(); discoveryRevision = discovery
        var request = try db.beginManifest()
        let first = try await remote.discovery(after: nil, scope: scope)
        try current(ticket)
        try db.discoveryPage(first, revision: discovery, after: nil)
        var resets = 0
        var pages = 0
        while true {
            try current(ticket)
            let page = try await remote.manifest(request, scope: scope)
            try current(ticket)
            pages += 1
            guard pages <= 10_001 else { throw RoomsError.incomplete }
            if page.resetRequired { resets += 1; guard resets <= 2 else { throw RoomsError.incomplete } }
            guard let next = try db.manifestPage(page, request: request) else { return try db.listing() }
            request = next
        }
    }
    public func loadMore() async throws -> RoomsListing {
        guard !busy, let discoveryRevision else { throw RoomsError.incomplete }
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
    private func current(_ ticket: UUID) throws {
        try scope.check()
        guard ticket == revision else { throw RoomsError.staleScope }
    }
}
