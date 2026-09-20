import Foundation

private final class MediaDownloadDelegate: NSObject, URLSessionTaskDelegate, Sendable {
    func urlSession(_ session: URLSession, task: URLSessionTask, willPerformHTTPRedirection response: HTTPURLResponse,
                    newRequest request: URLRequest, completionHandler: @escaping @Sendable (URLRequest?) -> Void) {
        completionHandler(nil)
    }
}
enum MediaDownload {
    // Credential-free Range GET into private scratch: AVPlayer seeks locally without retaining a
    // signed URL beyond expiry. Caller deletes scratch on disappearance/scope invalidation.
    static func fetch(_ lease: MediaLease, scope: any MediaScope) async throws -> URL {
        let video = lease.variant == .video
        let cap: Int64 = video ? 52 * 1024 * 1024 : 10 * 1024 * 1024
        var request = URLRequest(url: try lease.checkedURL(scope: scope))
        request.httpShouldHandleCookies = false
        request.setValue("identity", forHTTPHeaderField: "Accept-Encoding")
        if video { request.setValue("bytes=0-", forHTTPHeaderField: "Range") }
        let config = URLSessionConfiguration.ephemeral
        config.httpCookieStorage = nil; config.urlCredentialStorage = nil; config.urlCache = nil
        config.timeoutIntervalForRequest = 20; config.timeoutIntervalForResource = 180
        let session = URLSession(configuration: config, delegate: MediaDownloadDelegate(), delegateQueue: nil)
        defer { session.invalidateAndCancel() }
        let destination = FileManager.default.temporaryDirectory.appendingPathComponent("media-display-" + UUID().uuidString).appendingPathExtension(video ? "mp4" : "image")
        do {
            let (bytes, response) = try await session.bytes(for: request)
            defer { bytes.task.cancel() }
            guard let response = response as? HTTPURLResponse, response.url == request.url else { throw MediaError.invalid }
            let length = response.expectedContentLength
            try validateResponse(variant: lease.variant, status: response.statusCode, length: length, type: response.mimeType,
                                 range: response.value(forHTTPHeaderField: "Content-Range"), encoding: response.value(forHTTPHeaderField: "Content-Encoding"))
            guard FileManager.default.createFile(atPath: destination.path, contents: nil, attributes: [.posixPermissions: 0o600]) else { throw MediaError.invalid }
            let file = try FileHandle(forWritingTo: destination); defer { try? file.close() }
            var chunk = Data(); var total: Int64 = 0
            for try await byte in bytes {
                try Task.checkCancellation(); total += 1
                guard total <= cap, total <= length else { throw MediaError.invalid }
                chunk.append(byte)
                if chunk.count == 65536 { try scope.check(); try file.write(contentsOf: chunk); chunk.removeAll(keepingCapacity: true) }
            }
            try scope.check(); guard total == length else { throw MediaError.invalid }
            try file.write(contentsOf: chunk); return destination
        } catch { try? FileManager.default.removeItem(at: destination); throw error }
    }
    static func validateResponse(variant: MediaVariant, status: Int, length: Int64, type: String?, range: String?, encoding: String?) throws {
        let video = variant == .video
        let cap: Int64 = video ? 52 * 1024 * 1024 : 10 * 1024 * 1024
        guard status == 200 || (video && status == 206) else { throw MediaError.response(status, nil) }
        guard length > 0, length <= cap,
              video ? type == "video/mp4" : ["image/jpeg", "image/png", "image/webp"].contains(type ?? "") else { throw MediaError.invalid }
        if let encoding, encoding != "identity" { throw MediaError.invalid }
        if status == 206, range != "bytes 0-\(length - 1)/\(length)" { throw MediaError.invalid }
    }

}

// Invoke once before starting media jobs at process startup, never during active transfers.
func purgeMediaScratchAtProcessStart() throws {
    let directory = FileManager.default.temporaryDirectory
    for file in try FileManager.default.contentsOfDirectory(at: directory, includingPropertiesForKeys: [.isRegularFileKey]) {
        if (file.lastPathComponent.hasPrefix("media-pick-") || file.lastPathComponent.hasPrefix("media-display-")),
           try file.resourceValues(forKeys: [.isRegularFileKey]).isRegularFile == true {
            try FileManager.default.removeItem(at: file)
        }
    }
}

// A failed startup purge is retryable before the first media job; successful preparation
// is process-wide and never repeats while uploads or authorized playback are active.
final class MediaScratchLifecycle: @unchecked Sendable {
    static let shared = MediaScratchLifecycle()
    private let lock = NSLock()
    private var prepared = false
    func prepare() throws {
        try lock.withLock {
            if prepared { return }
            try purgeMediaScratchAtProcessStart()
            prepared = true
        }
    }
}
