import Foundation

struct PendingMedia: Codable, Sendable, Equatable { let assetId: String; let kind: MediaKind }
// Journal owner must atomically check original scope at database commit. No signed URLs/tokens.
protocol MediaJournal: Sendable {
    func save(_ pending: PendingMedia, scope: any MediaScope) async throws
    func remove(_ assetID: String, scope: any MediaScope) async throws
}
enum MediaUploadState: Sendable {
    case idle, reserving, uploading(PendingMedia), processing(PendingMedia)
    case ready(PendingMedia, MediaReceipt), failed(PendingMedia?), cancelled
}
@MainActor final class MediaUpload {
    private let client: MediaClient
    private let journal: any MediaJournal
    private(set) var state: MediaUploadState = .idle
    init(client: MediaClient, journal: any MediaJournal) { self.client = client; self.journal = journal }
    func start(_ file: MediaFile) async throws -> MediaReceipt {
        switch state { case .reserving, .uploading, .processing: throw MediaError.invalid; default: break }
        var pending: PendingMedia?
        defer { file.remove() }
        do {
            try client.scope.check(); state = .reserving
            let receipt = try await client.reserve(file)
            let record = PendingMedia(assetId: receipt.assetId, kind: file.kind); pending = record
            try await journal.save(record, scope: client.scope); try client.scope.check()
            state = .uploading(record)
            _ = try await client.upload(record.assetId, file: file)
            state = .processing(record)
            let ready = try await client.awaitReady(record.assetId)
            try client.scope.check(); state = .ready(record, ready); return ready
        } catch { state = error is CancellationError || Task.isCancelled ? .cancelled : .failed(pending); throw error }
    }
    // Restart recovery only polls. Unknown admission must never cause an automatic upload replay.
    func recover(_ pending: PendingMedia) async throws -> MediaReceipt {
        switch state { case .reserving, .uploading, .processing: throw MediaError.invalid; default: break }
        do {
            try client.scope.check(); state = .processing(pending)
            let ready = try await client.awaitReady(pending.assetId)
            try client.scope.check(); state = .ready(pending, ready); return ready
        } catch { state = error is CancellationError || Task.isCancelled ? .cancelled : .failed(pending); throw error }
    }
    // Call after the owning send/profile coordinator durably accepted the server acknowledgement.
    func acknowledged(_ assetID: String) async throws {
        try client.scope.check(); try await journal.remove(mediaID(assetID), scope: client.scope)
    }
}
