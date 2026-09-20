import Foundation

enum ProviderAvatarState: Sendable {
    case loading, failed
    case ready(Data, MediaLease)
}

// Active-view ownership only: no disk cache, raw source URL, persisted ticket or cross-scope reuse.
// All messages for one original scope/actor share authorization, bytes and expiry.
actor ProviderAvatarLoads {
    static let shared = ProviderAvatarLoads()
    struct Key: Hashable, Sendable { let scope: String; let actor: String? }
    struct Subscription: Sendable {
        let key: Key; let id: UUID; let states: AsyncStream<ProviderAvatarState>
    }
    private struct Entry {
        let id = UUID()
        let scope: any MediaScope
        let load: @Sendable () async throws -> (Data, MediaLease)
        var readers: [UUID: AsyncStream<ProviderAvatarState>.Continuation] = [:]
        var state: ProviderAvatarState = .loading
        var task: Task<Void, Never>?
    }
    private var entries: [Key: Entry] = [:]
    private var activeTransfers = 0
    private let poll: Duration
    init(poll: Duration = .milliseconds(250)) { self.poll = poll }
    func subscribe(scope: any MediaScope, actor: String?, load: @escaping @Sendable () async throws -> (Data, MediaLease)) throws -> Subscription {
        try scope.check(); try Task.checkCancellation()
        let key = Key(scope: scope.presentationID, actor: actor), subscriber = UUID()
        let (stream, continuation) = AsyncStream<ProviderAvatarState>.makeStream(bufferingPolicy: .bufferingNewest(1))
        let fresh = entries[key] == nil
        if fresh { entries[key] = Entry(scope: scope, load: load) }
        entries[key]!.readers[subscriber] = continuation
        continuation.yield(entries[key]!.state)
        continuation.onTermination = { @Sendable _ in Task { await self.remove(key: key, subscriber: subscriber) } }
        if fresh { start(key) }
        return Subscription(key: key, id: subscriber, states: stream)
    }
    func release(_ subscription: Subscription) { remove(key: subscription.key, subscriber: subscription.id) }
    private func remove(key: Key, subscriber: UUID) {
        guard var entry = entries[key] else { return }
        entry.readers.removeValue(forKey: subscriber)?.finish()
        if entry.readers.isEmpty { entries.removeValue(forKey: key); entry.task?.cancel() }
        else { entries[key] = entry }
    }
    func retry(scope: any MediaScope, actor: String?) throws {
        try scope.check()
        let key = Key(scope: scope.presentationID, actor: actor)
        if let entry = entries[key], entry.task == nil { start(key) }
    }
    private func start(_ key: Key) {
        guard let entry = entries[key] else { return }
        entries[key]!.task = Task { await run(key, id: entry.id, scope: entry.scope, load: entry.load) }
    }
    private func publish(_ state: ProviderAvatarState, key: Key, id: UUID) {
        guard entries[key]?.id == id else { return }
        entries[key]!.state = state
        for continuation in entries[key]!.readers.values { continuation.yield(state) }
    }
    private func transfer(scope: any MediaScope, load: @Sendable () async throws -> (Data, MediaLease)) async throws -> (Data, MediaLease) {
        let deadline = ContinuousClock.now.advanced(by: .seconds(15))
        while activeTransfers >= 2 {
            try scope.check()
            guard ContinuousClock.now < deadline else { throw MediaError.unavailable }
            try await Task.sleep(for: .milliseconds(50))
        }
        guard ContinuousClock.now < deadline else { throw MediaError.unavailable }
        try Task.checkCancellation(); try scope.check()
        activeTransfers += 1
        defer { activeTransfers -= 1 }
        return try await load()
    }
    private func run(_ key: Key, id: UUID, scope: any MediaScope, load: @Sendable () async throws -> (Data, MediaLease)) async {
        do {
            while true {
                try Task.checkCancellation(); try scope.check()
                publish(.loading, key: key, id: id)
                let (bytes, lease) = try await transfer(scope: scope, load: load)
                try Task.checkCancellation(); _ = try lease.checkedURL(scope: scope)
                publish(.ready(bytes, lease), key: key, id: id)
                while !lease.needsRenewal() { try await Task.sleep(for: poll); _ = try lease.checkedURL(scope: scope) }
                // Clear the old source before acquiring a fresh ticket AND fresh bytes.
                publish(.loading, key: key, id: id)
            }
        } catch {
            if entries[key]?.id == id {
                entries[key]!.task = nil
                publish(.failed, key: key, id: id)
            }
        }
    }
}
