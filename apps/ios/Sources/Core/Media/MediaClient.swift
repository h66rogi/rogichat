import Foundation

// NativeAPIClient owner mounts this request through the existing original credential/permit.
// Adapter checks admission/HTTP/commit, cancels on invalidation, rejects redirects, bounds JSON
// to 1 MiB, enforces expectedStatus and streams upload.url as exact application/octet-stream.
struct MediaRequest: Sendable {
    let method: String
    let path: String
    let expectedStatus: Int
    let jsonBody: Data?
    let upload: MediaFile?
    fileprivate init(_ method: String, _ path: String, _ status: Int, body: Data? = nil, upload: MediaFile? = nil) {
        self.method = method; self.path = path; self.expectedStatus = status; self.jsonBody = body; self.upload = upload
    }
}
protocol MediaTransport: Sendable { func perform(_ request: MediaRequest, scope: any MediaScope) async throws -> Data }
struct MediaClient: Sendable {
    let transport: any MediaTransport
    let scope: any MediaScope
    var apiBaseURL: URL? = nil
    private func request(_ request: MediaRequest) async throws -> Data {
        try scope.check(); try Task.checkCancellation(); try request.upload?.validate()
        let result = try await transport.perform(request, scope: scope)
        try scope.check(); try Task.checkCancellation()
        guard result.count <= 1_048_576 else { throw MediaError.invalid }; return result
    }
    func reserve(_ file: MediaFile) async throws -> MediaReceipt {
        guard file.kind != .avatar || scope.roomID == nil else { throw MediaError.invalid }
        let intent = try MediaIntent(file: file, roomID: file.kind == .avatar ? nil : scope.roomID)
        let data = try await request(MediaRequest("POST", "media/upload-intents", 201, body: JSONEncoder().encode(intent)))
        let receipt = try JSONDecoder().decode(MediaReceipt.self, from: data).validated()
        guard receipt.status == .reserved else { throw MediaError.invalid }; return receipt
    }
    func upload(_ assetID: String, file: MediaFile) async throws -> MediaReceipt {
        let path = "media/upload-intents/\(try mediaID(assetID))/content"
        let data = try await request(MediaRequest("POST", path, 202, upload: file))
        let receipt = try JSONDecoder().decode(MediaReceipt.self, from: data).validated(assetID: assetID)
        guard receipt.status == .processing else { throw MediaError.invalid }; return receipt
    }
    func status(_ assetID: String) async throws -> MediaReceipt {
        let data = try await request(MediaRequest("GET", "media/upload-intents/\(try mediaID(assetID))", 200))
        return try JSONDecoder().decode(MediaReceipt.self, from: data).validated(assetID: assetID)
    }
    func awaitReady(_ assetID: String, attempts: Int = 60) async throws -> MediaReceipt {
        guard (1...120).contains(attempts) else { throw MediaError.invalid }
        for _ in 0..<attempts {
            let receipt = try await status(assetID)
            switch receipt.status {
            case .ready: return receipt
            case .deleting, .deleted: throw MediaError.unavailable
            default: try await Task.sleep(for: .seconds(2))
            }
        }
        throw MediaError.processing
    }
    func access(_ assetID: String, context: MediaAccess) async throws -> MediaLease {
        guard context.roomID == nil || context.roomID == scope.roomID else { throw MediaError.invalid }
        let started = ContinuousClock.now
        let data = try await request(MediaRequest("POST", "media/assets/\(try mediaID(assetID))/access", 200, body: context.body()))
        struct Receipt: Decodable { let url: URL; let expiresIn: Int }
        let receipt = try JSONDecoder().decode(Receipt.self, from: data)
        guard receipt.expiresIn == 60 else { throw MediaError.invalid }
        return try MediaLease(url: receipt.url, started: started, variant: context.variant)
    }
    func renewAccess(_ assetID: String, context: MediaAccess, replacing: MediaLease) async throws -> MediaLease {
        _ = try replacing.checkedURL(scope: scope)
        let budget = replacing.renewalBudget()
        return try await withThrowingTaskGroup(of: MediaLease.self) { group in
            group.addTask { let lease = try await access(assetID, context: context); _ = try lease.checkedURL(scope: scope); return lease }
            group.addTask { try await Task.sleep(for: budget); throw MediaError.expired }
            defer { group.cancelAll() }
            guard let lease = try await group.next() else { throw MediaError.expired }; return lease
        }
    }
    func providerAvatar(actorID: String? = nil) async throws -> MediaLease {
        let path: String
        if let actorID {
            guard let room = scope.roomID else { throw MediaError.invalid }
            path = "rooms/\(try mediaID(room))/actors/\(try mediaID(actorID))/provider-avatar/access"
        } else {
            guard scope.roomID == nil else { throw MediaError.invalid }
            path = "me/provider-avatar/access"
        }
        let started = ContinuousClock.now
        let data = try await request(MediaRequest("POST", path, 200))
        struct Receipt: Decodable { let url: URL; let expiresIn: Int }
        let receipt = try JSONDecoder().decode(Receipt.self, from: data)
        guard receipt.expiresIn == 60 else { throw MediaError.invalid }
        try validateProviderAvatarURL(receipt.url, apiBaseURL: apiBaseURL)
        return try MediaLease(url: receipt.url, started: started, variant: .image)
    }
    func stickers(after: String? = nil) async throws -> MediaStickerPage {
        guard let room = scope.roomID else { throw MediaError.invalid }
        var path = "rooms/\(try mediaID(room))/stickers"
        if let after { path += "?after=\(try mediaID(after))" }
        let data = try await request(MediaRequest("GET", path, 200))
        let page = try JSONDecoder().decode(MediaStickerPage.self, from: data)
        for item in page.items { _ = try mediaID(item.id); _ = try mediaID(item.assetId) }
        if let next = page.nextCursor { _ = try mediaID(next) }
        return page
    }
    func updateAvatar(_ ready: MediaReceipt?) async throws {
        guard scope.roomID == nil else { throw MediaError.invalid }
        if let ready { _ = try ready.validated(); guard ready.status == .ready else { throw MediaError.invalid } }
        struct Body: Encodable {
            let avatarAssetId: String?
            enum CodingKeys: CodingKey { case avatarAssetId }
            func encode(to encoder: any Encoder) throws {
                var c = encoder.container(keyedBy: CodingKeys.self)
                if let avatarAssetId { try c.encode(avatarAssetId, forKey: .avatarAssetId) } else { try c.encodeNil(forKey: .avatarAssetId) }
            }
        }
        let data = try await request(MediaRequest("PATCH", "me/profile", 200, body: JSONEncoder().encode(Body(avatarAssetId: ready?.assetId))))
        struct Acknowledgement: Decodable {
            struct Avatar: Decodable { let assetId: String }
            let id: String
            let avatar: Avatar?
            enum CodingKeys: CodingKey { case id, avatar }
            init(from decoder: any Decoder) throws {
                let c = try decoder.container(keyedBy: CodingKeys.self)
                id = try c.decode(String.self, forKey: .id)
                avatar = try c.decode(Avatar?.self, forKey: .avatar)
            }
        }
        let result = try JSONDecoder().decode(Acknowledgement.self, from: data)
        _ = try mediaID(result.id)
        guard result.avatar?.assetId == ready?.assetId else { throw MediaError.invalid }
    }
}

func validateProviderAvatarURL(_ url: URL, apiBaseURL: URL?) throws {
    guard let apiBaseURL, let base = URLComponents(url: apiBaseURL, resolvingAgainstBaseURL: false),
          let value = URLComponents(url: url, resolvingAgainstBaseURL: false),
          base.scheme == "https", base.host != nil, base.user == nil, base.password == nil,
          base.percentEncodedPath == "/v1/", base.query == nil, base.fragment == nil,
          value.scheme == "https", value.host == base.host, value.port == base.port,
          value.user == nil, value.password == nil, value.fragment == nil,
          value.percentEncodedPath == "/v1/profile-images", let query = value.percentEncodedQuery,
          query.range(of: "^ticket=[A-Za-z0-9_-]{64,1024}$", options: .regularExpression) != nil else { throw MediaError.invalid }
}
