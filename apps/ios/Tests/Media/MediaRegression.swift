import Foundation

private let asset = "10000000-0000-4000-8000-000000000001"
private let room = "20000000-0000-4000-8000-000000000001"
private final class Scope: MediaScope, @unchecked Sendable {
    let presentationID = UUID().uuidString
    let roomID: String?
    init(roomID: String? = room) { self.roomID = roomID }
    private let lock = NSLock()
    private var valid = true
    func invalidate() { lock.withLock { valid = false } }
    func check() throws { if !lock.withLock({ valid }) { throw CancellationError() } }
}
private actor Transport: MediaTransport {
    var requests: [MediaRequest] = []
    var responses: [Data]
    let invalidate: Scope?
    init(_ responses: [String], invalidate: Scope? = nil) { self.responses = responses.map { Data($0.utf8) }; self.invalidate = invalidate }
    func perform(_ request: MediaRequest, scope: any MediaScope) throws -> Data {
        requests.append(request); invalidate?.invalidate()
        guard !responses.isEmpty else { throw MediaError.response(403, "FORBIDDEN") }; return responses.removeFirst()
    }
}
private actor SleepingTransport: MediaTransport {
    func perform(_ request: MediaRequest, scope: any MediaScope) async throws -> Data {
        try await Task.sleep(for: .seconds(30)); return Data()
    }
}
private actor Journal: MediaJournal {
    var pending: [PendingMedia] = []
    func save(_ record: PendingMedia, scope: any MediaScope) throws { try scope.check(); pending.append(record) }
    func remove(_ assetID: String, scope: any MediaScope) throws { try scope.check(); pending.removeAll { $0.assetId == assetID } }
}
private func receipt(_ status: String) -> String { "{\"assetId\":\"\(asset)\",\"status\":\"\(status)\"}" }
private func expectFailure(_ body: () throws -> Void) throws {
    do { try body() } catch { return }; throw MediaError.invalid
}
@main struct MediaRegression {
    @MainActor static func main() async throws {
        let selfScope = Scope(roomID: nil)
        let providerReceipt = "{\"url\":\"https://api.qa.rogi.chat/v1/profile-images?ticket=opaque\",\"expiresIn\":60}"
        let providerTransport = Transport([providerReceipt, providerReceipt])
        let ownPhoto = try await MediaClient(transport: providerTransport, scope: selfScope).providerAvatar()
        let selfRequest = await providerTransport.requests[0]
        precondition(selfRequest.path == "me/provider-avatar/access" && selfRequest.method == "POST" && selfRequest.jsonBody == nil)
        _ = try ownPhoto.checkedURL(scope: selfScope)
        selfScope.invalidate()
        try expectFailure { _ = try ownPhoto.checkedURL(scope: selfScope) }
        _ = try await MediaClient(transport: providerTransport, scope: Scope()).providerAvatar(actorID: asset)
        let actorRequest = await providerTransport.requests[1]
        precondition(actorRequest.path == "rooms/\(room)/actors/\(asset)/provider-avatar/access" && actorRequest.jsonBody == nil)
        let scope = Scope()
        let ready = MediaReceipt(assetId: asset, status: .ready)
        try expectFailure { _ = try JSONEncoder().encode(MediaContent.attachments(.video, [ready, ready])) }
        try expectFailure { _ = try JSONEncoder().encode(MediaContent.attachments(.photo, [MediaReceipt(assetId: asset, status: .processing)])) }
        try expectFailure { _ = try JSONEncoder().encode(MediaContent.attachments(.avatar, [ready])) }
        let sticker = try JSONSerialization.jsonObject(with: JSONEncoder().encode(MediaContent.sticker(asset))) as! [String: String]
        precondition(sticker == ["type": "STICKER", "stickerId": asset])
        let expired = try MediaLease(url: URL(string: "https://example.org/object")!, started: .now.advanced(by: .seconds(-60)), variant: .video)
        try expectFailure { _ = try expired.checkedURL(scope: scope) }
        try expectFailure { _ = try MediaLease(url: URL(string: "http://example.org/object")!, started: .now, variant: .image) }
        try MediaDownload.validateResponse(variant: .video, status: 206, length: 20, type: "video/mp4", range: "bytes 0-19/20", encoding: nil)
        try expectFailure { try MediaDownload.validateResponse(variant: .video, status: 206, length: 20, type: "video/mp4", range: "bytes 20-39/40", encoding: nil) }
        try expectFailure { try MediaDownload.validateResponse(variant: .video, status: 403, length: 20, type: "video/mp4", range: nil, encoding: nil) }
        try expectFailure { try MediaDownload.validateResponse(variant: .video, status: 200, length: 20, type: "text/html", range: nil, encoding: nil) }
        let started = ContinuousClock.now
        let renewingLease = try MediaLease(url: URL(string: "https://example.org/object")!, started: started, variant: .video)
        precondition(!renewingLease.needsRenewal(at: started.advanced(by: .seconds(34))))
        precondition(renewingLease.needsRenewal(at: started.advanced(by: .seconds(35))))
        precondition(renewingLease.renewalBudget(at: started.advanced(by: .seconds(54))) == .seconds(1))
        let identity = MediaPresentationIdentity(scopeID: "one", assetID: asset, access: .message(room: room, message: asset, variant: .video))
        precondition(identity != MediaPresentationIdentity(scopeID: "two", assetID: asset, access: identity.access))
        precondition(identity != MediaPresentationIdentity(scopeID: "one", assetID: asset, access: .message(room: room, message: asset, variant: .poster)))
        let overlapURL = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        try Data([1]).write(to: overlapURL)
        let overlapping = MediaUpload(client: MediaClient(transport: SleepingTransport(), scope: scope), journal: Journal())
        let active = Task { try await overlapping.start(MediaFile(url: overlapURL, kind: .photo, contentType: "image/png")) }
        while case .idle = overlapping.state { await Task.yield() }
        do { _ = try await overlapping.recover(PendingMedia(assetId: asset, kind: .photo)); fatalError("overlap admitted") }
        catch MediaError.invalid { }
        active.cancel()
        do { _ = try await active.value; fatalError("cancellation ignored") } catch is CancellationError { }
        precondition(!FileManager.default.fileExists(atPath: overlapURL.path))
        let fileURL = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        try Data([1, 2, 3]).write(to: fileURL)
        let file = try MediaFile(url: fileURL, kind: .video, contentType: "video/mp4")
        let transport = Transport([receipt("reserved"), receipt("processing"), receipt("ready"), "{\"id\":\"\(asset)\",\"avatar\":null}"])
        let client = MediaClient(transport: transport, scope: scope)
        let journal = Journal(); let upload = MediaUpload(client: client, journal: journal)
        let result = try await upload.start(file)
        precondition(result.status == .ready && !FileManager.default.fileExists(atPath: fileURL.path))
        let requests = await transport.requests
        precondition(requests.map(\.expectedStatus) == [201, 202, 200])
        precondition(requests[1].upload?.byteLength == 3 && requests[1].jsonBody == nil)
        let saved = await journal.pending; precondition(saved.count == 1)
        try await MediaClient(transport: transport, scope: Scope(roomID: nil)).updateAvatar(nil)
        let patch = await transport.requests.last!
        precondition(String(data: patch.jsonBody!, encoding: .utf8) == "{\"avatarAssetId\":null}")
        try await upload.acknowledged(asset)
        let cleared = await journal.pending; precondition(cleared.isEmpty)
        let recoveredTransport = Transport([receipt("ready")])
        let recovered = MediaUpload(client: MediaClient(transport: recoveredTransport, scope: scope), journal: journal)
        _ = try await recovered.recover(PendingMedia(assetId: asset, kind: .video))
        let recoveryCalls = await recoveredTransport.requests; precondition(recoveryCalls.map(\.method) == ["GET"])
        let stale = Scope(); let staleTransport = Transport([receipt("ready")], invalidate: stale)
        do { _ = try await MediaClient(transport: staleTransport, scope: stale).status(asset); fatalError("stale completion escaped") }
        catch is CancellationError { }
        let failedURL = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        try Data([1]).write(to: failedURL)
        let failureUpload = MediaUpload(client: MediaClient(transport: Transport([receipt("reserved")]), scope: scope), journal: journal)
        do { _ = try await failureUpload.start(MediaFile(url: failedURL, kind: .photo, contentType: "image/png")); fatalError("expected 403") }
        catch MediaError.response(403, _) { }
        precondition(!FileManager.default.fileExists(atPath: failedURL.path))
        if case .failed(let pending) = failureUpload.state { precondition(pending?.assetId == asset) } else { fatalError("lost recovery record") }
        print("Media regression passed: content, expiry, typed requests, upload cleanup, original scope, status-only recovery, avatar null")
    }
}
