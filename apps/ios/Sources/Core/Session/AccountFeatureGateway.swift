import Foundation
#if canImport(RogichatRooms)
import RogichatRooms
#endif

protocol AccountFeatureRequesting: Sendable {
    func performAccountFeature(_ input: ConversationFeatureRequest, credential: NativeCredential, scope: RoomsScope) async throws -> Data
}
extension ConversationFeatureRequest {
    func accountRequest(environment: NativeEnvironment, credential: NativeCredential) throws -> URLRequest {
        guard credential.isValid, credential.environment == environment else { throw ProductError.secureStorage }
        let parts = path.split(separator: "/").map(String.init)
        if parts.first == "media" {
            try validate(room: UUID().uuidString.lowercased())
        } else if parts == ["blocked-rooms"] {
            guard method == "GET", body == nil, upload == nil, expectedStatus == 200,
                  query.keys.allSatisfy({ $0 == "cursor" }), query.values.allSatisfy({ !$0.isEmpty && $0.utf8.count <= 2200 && !$0.unicodeScalars.contains(where: { CharacterSet.whitespacesAndNewlines.union(.controlCharacters).contains($0) }) }) else { throw ProductError.invalidResponse }
        } else if parts == ["me", "provider-avatar", "access"] {
            guard method == "POST", body == nil, upload == nil, expectedStatus == 200, query.isEmpty else { throw ProductError.invalidResponse }
        } else if parts == ["me", "profile"] {
            guard method == "PATCH", upload == nil, expectedStatus == 200, let body,
                  let object = try JSONSerialization.jsonObject(with: body) as? [String: Any], Set(object.keys) == ["avatarAssetId"],
                  object["avatarAssetId"] is NSNull || (object["avatarAssetId"] as? String).map(RoomsWire.uuid) == true else { throw ProductError.invalidResponse }
        } else {
            guard parts.count >= 3, parts.count <= 4, parts[0] == "rooms", RoomsWire.uuid(parts[1]), parts[2] == "blocks",
                  parts.count == 3 ? method == "GET" : method == "DELETE" && RoomsWire.uuid(parts[3]) else { throw ProductError.invalidResponse }
        }
        if parts != ["blocked-rooms"] {
            guard query.keys.allSatisfy({ $0 == "after" }), query.values.allSatisfy(RoomsWire.uuid), query.isEmpty || (parts.last == "blocks" && method == "GET") else { throw ProductError.invalidResponse }
        }
        var components = URLComponents(url: environment.baseURL.appendingPathComponent(path), resolvingAgainstBaseURL: false)!
        if !query.isEmpty { components.queryItems = query.sorted { $0.key < $1.key }.map { URLQueryItem(name: $0.key, value: $0.value) } }
        var request = URLRequest(url: components.url!)
        request.httpMethod = method; request.httpBody = body; request.httpShouldHandleCookies = false; request.cachePolicy = .reloadIgnoringLocalCacheData
        request.setValue("Bearer \(credential.token)", forHTTPHeaderField: "Authorization")
        request.setValue("ios", forHTTPHeaderField: "X-Rogi-Client"); request.setValue("application/json", forHTTPHeaderField: "Accept")
        if body != nil { request.setValue("application/json", forHTTPHeaderField: "Content-Type") }
        if let upload {
            let values = try upload.resourceValues(forKeys: [.isRegularFileKey, .isSymbolicLinkKey, .fileSizeKey])
            guard upload.isFileURL, values.isRegularFile == true, values.isSymbolicLink != true,
                  values.fileSize.map(Int64.init) == uploadBytes, let stream = InputStream(url: upload) else { throw ProductError.invalidResponse }
            request.httpBodyStream = stream; request.setValue("application/octet-stream", forHTTPHeaderField: "Content-Type")
            request.setValue(String(uploadBytes!), forHTTPHeaderField: "Content-Length")
        }
        return request
    }
}
