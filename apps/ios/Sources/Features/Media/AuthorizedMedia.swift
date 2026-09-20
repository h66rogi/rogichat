#if canImport(UIKit)
import SwiftUI
import AVKit
import ImageIO

struct AuthorizedMedia: View {
    let client: MediaClient
    let assetID: String
    let access: MediaAccess
    var avatar = false
    var body: some View {
        AuthorizedMediaBody(client: client, assetID: assetID, access: access, avatar: avatar)
            .id(MediaPresentationIdentity(scopeID: client.scope.presentationID, assetID: assetID, access: access))
    }
}
private struct AuthorizedMediaBody: View {
    let client: MediaClient
    let assetID: String?
    let access: MediaAccess
    let avatar: Bool
    var provider = false
    @State private var taskID: UUID?
    @State private var player: AVPlayer?
    @State private var image: UIImage?
    @State private var failed = false
    @State private var retry = 0
    var body: some View {
        VStack {
            if failed {
                if !avatar { Text("미디어를 표시할 수 없어요.") }
                Button("다시 시도") { retry += 1 }
            } else if let player { VideoPlayer(player: player) }
            else if let image {
                if avatar { Image(uiImage: image).resizable().scaledToFill().accessibilityLabel("프로필 사진") }
                else { Image(uiImage: image).resizable().scaledToFit() }
            }
            else { ProgressView() }
        }
        .task(id: retry) {
            let operation = UUID(); taskID = operation
            failed = false
            var scratch: URL?
            defer {
                if taskID == operation { player?.pause(); player?.replaceCurrentItem(with: nil); player = nil; image = nil }
                if let scratch { try? FileManager.default.removeItem(at: scratch) }
            }
            do {
                var lease: MediaLease
                if provider { lease = try await client.providerAvatar(actorID: assetID) }
                else { lease = try await client.access(assetID!, context: access) }
                let url = try await MediaDownload.fetch(lease, scope: client.scope); scratch = url
                _ = try lease.checkedURL(scope: client.scope)
                if access.variant == .video { player = AVPlayer(url: url) }
                else {
                    guard let source = CGImageSourceCreateWithURL(url as CFURL, nil),
                          let properties = CGImageSourceCopyPropertiesAtIndex(source, 0, nil) as? [CFString: Any],
                          let width = properties[kCGImagePropertyPixelWidth] as? Int,
                          let height = properties[kCGImagePropertyPixelHeight] as? Int,
                          width > 0, height > 0, width <= 20_000_000 / height,
                          let decoded = CGImageSourceCreateThumbnailAtIndex(source, 0, [
                            kCGImageSourceCreateThumbnailFromImageAlways: true,
                            kCGImageSourceCreateThumbnailWithTransform: true,
                            kCGImageSourceThumbnailMaxPixelSize: 2048] as CFDictionary) else { throw MediaError.invalid }
                    image = UIImage(cgImage: decoded)
                }
                while true {
                    try await Task.sleep(for: .milliseconds(250)); _ = try lease.checkedURL(scope: client.scope)
                    if lease.needsRenewal() {
                        if provider { retry += 1; break }
                        else { lease = try await client.renewAccess(assetID!, context: access, replacing: lease) }
                    }
                    if player?.currentItem?.status == .failed { throw MediaError.unavailable }
                }
            } catch { if !Task.isCancelled && taskID == operation { failed = true } }
        }
    }
}
struct AuthorizedProviderAvatar: View {
    let client: MediaClient
    var actorID: String? = nil
    var body: some View {
        AuthorizedMediaBody(client: client, assetID: actorID, access: .preview(.image), avatar: true, provider: true)
            .id(client.scope.presentationID + ":provider:" + (actorID ?? "self"))
    }
}
#endif
