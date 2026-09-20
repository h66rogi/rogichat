import Foundation

private let testAPIBaseURL = URL(string: "https://api.qa.rogi.chat/v1/")!
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
        let providerReceipt = "{\"url\":\"https://api.qa.rogi.chat/v1/profile-images?ticket=\(String(repeating: "a", count: 64))\",\"expiresIn\":60}"
        let providerTransport = Transport([providerReceipt, providerReceipt])
        let ownPhoto = try await MediaClient(transport: providerTransport, scope: selfScope, apiBaseURL: testAPIBaseURL).providerAvatar()
        let selfRequest = await providerTransport.requests[0]
        precondition(selfRequest.path == "me/provider-avatar/access" && selfRequest.method == "POST" && selfRequest.jsonBody == nil)
        _ = try ownPhoto.checkedURL(scope: selfScope)
        selfScope.invalidate()
        try expectFailure { _ = try ownPhoto.checkedURL(scope: selfScope) }
        _ = try await MediaClient(transport: providerTransport, scope: Scope(), apiBaseURL: testAPIBaseURL).providerAvatar(actorID: asset)
        let prodScope = Scope(roomID: nil), prodBase = URL(string: "https://api.rogi.chat/v1/")!
        let prodReceipt = providerReceipt.replacingOccurrences(of: "api.qa.rogi.chat", with: "api.rogi.chat")
        let prod = try await MediaClient(transport: Transport([prodReceipt]), scope: prodScope, apiBaseURL: prodBase).providerAvatar()
        let prodURL = try prod.checkedURL(scope: prodScope); precondition(prodURL.host == "api.rogi.chat")
        let actorRequest = await providerTransport.requests[1]
        precondition(actorRequest.path == "rooms/\(room)/actors/\(asset)/provider-avatar/access" && actorRequest.jsonBody == nil)
        let base = URL(string: "https://api.qa.rogi.chat/v1/")!, ticket = String(repeating: "a", count: 64)
        try validateProviderAvatarURL(URL(string: "\(base)profile-images?ticket=\(ticket)")!, apiBaseURL: base)
        for text in ["https://api.rogi.chat/v1/profile-images?ticket=\(ticket)", "https://provider.example/image.jpg",
                     "\(base)profile-images/extra?ticket=\(ticket)", "\(base)%70rofile-images?ticket=\(ticket)",
                     "\(base)profile-images?ticket=\(ticket)&ticket=\(ticket)", "\(base)profile-images?ticket=short",
                     "\(base)profile-images?ticket=\(String(repeating: "a", count: 1025))",
                     "\(base)profile-images?ticket=%61\(String(repeating: "a", count: 63))",
                     "\(base)profile-images?ticket=\(ticket)#fragment",
                     "https://user@api.qa.rogi.chat/v1/profile-images?ticket=\(ticket)",
                     "https://api.qa.rogi.chat:8443/v1/profile-images?ticket=\(ticket)"] {
            try expectFailure { try validateProviderAvatarURL(URL(string: text)!, apiBaseURL: base) }
        }
        try expectFailure { try validateProviderAvatarURL(URL(string: "\(base)profile-images?ticket=\(ticket)")!, apiBaseURL: nil) }
        try MediaDownload.validateResponse(variant: .image, status: 200, length: 2 * 1024 * 1024, type: "image/webp", range: nil, encoding: nil, provider: true)
        try expectFailure { try MediaDownload.validateResponse(variant: .image, status: 200, length: 2 * 1024 * 1024 + 1, type: "image/jpeg", range: nil, encoding: nil, provider: true) }
        try expectFailure { try MediaDownload.validateResponse(variant: .image, status: 200, length: 1, type: "image/png", range: nil, encoding: nil, provider: true) }
        try MediaDownload.validateResponse(variant: .image, status: 200, length: 3 * 1024 * 1024, type: "image/png", range: nil, encoding: nil)
        try await providerSharingRegression()
        try await providerCancellationRegression()
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
        let overlapping = MediaUpload(client: MediaClient(transport: SleepingTransport(), scope: scope, apiBaseURL: testAPIBaseURL), journal: Journal())
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
        let client = MediaClient(transport: transport, scope: scope, apiBaseURL: testAPIBaseURL)
        let journal = Journal(); let upload = MediaUpload(client: client, journal: journal)
        let result = try await upload.start(file)
        precondition(result.status == .ready && !FileManager.default.fileExists(atPath: fileURL.path))
        let requests = await transport.requests
        precondition(requests.map(\.expectedStatus) == [201, 202, 200])
        precondition(requests[1].upload?.byteLength == 3 && requests[1].jsonBody == nil)
        let saved = await journal.pending; precondition(saved.count == 1)
        try await MediaClient(transport: transport, scope: Scope(roomID: nil), apiBaseURL: testAPIBaseURL).updateAvatar(nil)
        let patch = await transport.requests.last!
        precondition(String(data: patch.jsonBody!, encoding: .utf8) == "{\"avatarAssetId\":null}")
        try await upload.acknowledged(asset)
        let cleared = await journal.pending; precondition(cleared.isEmpty)
        let recoveredTransport = Transport([receipt("ready")])
        let recovered = MediaUpload(client: MediaClient(transport: recoveredTransport, scope: scope, apiBaseURL: testAPIBaseURL), journal: journal)
        _ = try await recovered.recover(PendingMedia(assetId: asset, kind: .video))
        let recoveryCalls = await recoveredTransport.requests; precondition(recoveryCalls.map(\.method) == ["GET"])
        let stale = Scope(); let staleTransport = Transport([receipt("ready")], invalidate: stale)
        do { _ = try await MediaClient(transport: staleTransport, scope: stale, apiBaseURL: testAPIBaseURL).status(asset); fatalError("stale completion escaped") }
        catch is CancellationError { }
        let failedURL = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        try Data([1]).write(to: failedURL)
        let failureUpload = MediaUpload(client: MediaClient(transport: Transport([receipt("reserved")]), scope: scope, apiBaseURL: testAPIBaseURL), journal: journal)
        do { _ = try await failureUpload.start(MediaFile(url: failedURL, kind: .photo, contentType: "image/png")); fatalError("expected 403") }
        catch MediaError.response(403, _) { }
        precondition(!FileManager.default.fileExists(atPath: failedURL.path))
        if case .failed(let pending) = failureUpload.state { precondition(pending?.assetId == asset) } else { fatalError("lost recovery record") }
        print("Media regression passed: content, expiry, typed requests, upload cleanup, original scope, status-only recovery, avatar null")
    }
}

private actor ProviderProbe {
    var started = 0; var active = 0; var peak = 0
    let renewFirst: Bool
    init(renewFirst: Bool = false) { self.renewFirst = renewFirst }
    func load() async throws -> (Data, MediaLease) {
        started += 1; active += 1; peak = max(peak, active)
        let n = started
        defer { active -= 1 }
        try await Task.sleep(for: .milliseconds(100))
        let start = renewFirst && n == 1 ? ContinuousClock.now.advanced(by: .milliseconds(-34950)) : .now
        return (Data([UInt8(n)]), try MediaLease(url: URL(string: "https://example.org/object")!, started: start, variant: .image))
    }
}
private func providerSharingRegression() async throws {
    let loads = ProviderAvatarLoads(poll: .milliseconds(5)), scope = Scope(), probe = ProviderProbe()
    var subscriptions: [ProviderAvatarLoads.Subscription] = []
    for _ in 0..<5 { subscriptions.append(try await loads.subscribe(scope: scope, actor: asset) { try await probe.load() }) }
    for subscription in subscriptions {
        var found = false
        for await state in subscription.states { if case .ready = state { found = true; break } }
        precondition(found)
    }
    let count = await probe.started; precondition(count == 1)
    await loads.release(subscriptions.removeFirst())
    for n in 0..<6 { subscriptions.append(try await loads.subscribe(scope: scope, actor: "actor-\(n)") { try await probe.load() }) }
    for _ in 0..<600 {
        if await probe.started == 7, await probe.active == 0 { break }
        try await Task.sleep(for: .milliseconds(5))
    }
    let total = await probe.started, peak = await probe.peak
    precondition(total == 7 && peak == 2)
    for subscription in subscriptions { await loads.release(subscription) }
    let new = try await loads.subscribe(scope: scope, actor: asset) { try await probe.load() }
    for _ in 0..<600 { if await probe.started == 8 { break }; try await Task.sleep(for: .milliseconds(5)) }
    await loads.release(new)
    for _ in 0..<600 { if await probe.active == 0 { break }; try await Task.sleep(for: .milliseconds(5)) }
    let restarted = await probe.started, remaining = await probe.active
    precondition(restarted == 8 && remaining == 0)
    let renewed = ProviderProbe(renewFirst: true)
    let subscription = try await loads.subscribe(scope: scope, actor: asset) { try await renewed.load() }
    var seen: [UInt8] = []
    for await state in subscription.states {
        if case .ready(let bytes, _) = state { seen.append(bytes[0]); if bytes[0] == 2 { break } }
    }
    precondition(seen == [1, 2])
    scope.invalidate()
    var revoked = false
    for await state in subscription.states { if case .failed = state { revoked = true; break } }
    precondition(revoked)
    await loads.release(subscription)
    let renewals = await renewed.started; precondition(renewals == 2)
}

private actor ProviderCancellationProbe {
    var count = 0
    func blocking() async throws -> (Data, MediaLease) {
        count += 1; try await Task.sleep(for: .seconds(30)); throw MediaError.invalid
    }
    func late() async throws -> (Data, MediaLease) {
        count += 1; let n = count
        if n == 1 { try? await Task.sleep(for: .milliseconds(150)) }
        return (Data([UInt8(n)]), try MediaLease(url: URL(string: "https://example.org/object")!, started: .now, variant: .image))
    }
    func failOnce() throws -> (Data, MediaLease) {
        count += 1
        if count == 1 { throw MediaError.unavailable }
        return (Data([UInt8(count)]), try MediaLease(url: URL(string: "https://example.org/object")!, started: .now, variant: .image))
    }
}
private func providerCancellationRegression() async throws {
    let loads = ProviderAvatarLoads(poll: .milliseconds(5)), scope = Scope(), blocker = ProviderCancellationProbe()
    let first = try await loads.subscribe(scope: scope, actor: "first") { try await blocker.blocking() }
    let second = try await loads.subscribe(scope: scope, actor: "second") { try await blocker.blocking() }
    for _ in 0..<600 { if await blocker.count == 2 { break }; try await Task.sleep(for: .milliseconds(5)) }
    let queued = try await loads.subscribe(scope: scope, actor: "queued") { try await blocker.blocking() }
    try await Task.sleep(for: .milliseconds(80))
    await loads.release(queued); await loads.release(first); await loads.release(second)
    try await Task.sleep(for: .milliseconds(80))
    let started = await blocker.count; precondition(started == 2)
    let late = ProviderCancellationProbe()
    let old = try await loads.subscribe(scope: scope, actor: asset) { try await late.late() }
    for _ in 0..<600 { if await late.count == 1 { break }; try await Task.sleep(for: .milliseconds(5)) }
    await loads.release(old)
    let next = try await loads.subscribe(scope: scope, actor: asset) { try await late.late() }
    for await state in next.states { if case .ready(let bytes, _) = state { precondition(bytes == Data([2])); break } }
    try await Task.sleep(for: .milliseconds(200))
    let sibling = try await loads.subscribe(scope: scope, actor: asset) { try await late.late() }
    for await state in sibling.states { if case .ready(let bytes, _) = state { precondition(bytes == Data([2])); break } }
    let replaced = await late.count; precondition(replaced == 2)
    await loads.release(next); await loads.release(sibling)
    let failed = ProviderCancellationProbe()
    let reader = try await loads.subscribe(scope: scope, actor: asset) { try await failed.failOnce() }
    for await state in reader.states { if case .failed = state { break } }
    try await loads.retry(scope: scope, actor: asset)
    for await state in reader.states { if case .ready(let bytes, _) = state { precondition(bytes == Data([2])); break } }
    await loads.release(reader)
}
