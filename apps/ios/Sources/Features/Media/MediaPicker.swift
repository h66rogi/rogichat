#if canImport(PhotosUI) && canImport(UIKit)
import SwiftUI
import PhotosUI
import UniformTypeIdentifiers

private final class PickedMedia: Transferable, Sendable {
    let url: URL
    let contentType: String
    init(url: URL, contentType: String) { self.url = url; self.contentType = contentType }
    deinit { try? FileManager.default.removeItem(at: url) }
    static var transferRepresentation: some TransferRepresentation {
        FileRepresentation(importedContentType: .image) { try copy($0.file) }
        FileRepresentation(importedContentType: .movie) { try copy($0.file) }
    }
    private static func copy(_ source: URL) throws -> Self {
        let values = try source.resourceValues(forKeys: [.contentTypeKey, .fileSizeKey])
        guard let type = values.contentType?.preferredMIMEType,
              let size = values.fileSize, size > 0, size <= MediaKind.video.maximumBytes else { throw MediaError.invalid }
        let destination = FileManager.default.temporaryDirectory.appendingPathComponent("media-pick-" + UUID().uuidString).appendingPathExtension("upload")
        do {
            guard FileManager.default.createFile(atPath: destination.path, contents: nil, attributes: [.posixPermissions: 0o600]) else { throw MediaError.invalid }
            let input = try FileHandle(forReadingFrom: source); defer { try? input.close() }
            let output = try FileHandle(forWritingTo: destination); defer { try? output.close() }
            var total: Int64 = 0
            while let bytes = try input.read(upToCount: 65536), !bytes.isEmpty {
                try Task.checkCancellation(); total += Int64(bytes.count)
                guard total <= MediaKind.video.maximumBytes, total <= size else { throw MediaError.invalid }
                try output.write(contentsOf: bytes)
            }
            guard total == size else { throw MediaError.invalid }
            try FileManager.default.setAttributes([.posixPermissions: 0o600, .protectionKey: FileProtectionType.complete], ofItemAtPath: destination.path)
            return Self(url: destination, contentType: type)
        } catch { try? FileManager.default.removeItem(at: destination); throw error }
    }
}
// Adapted from ChannelSettingsView.ProfileImagePicker at Meloming 18a33bbf:
// retain PhotosPicker selection, disabled upload state and onChange import flow.
// File transfer replaces unbounded Data loading and the incorrect unconditional JPEG declaration.
struct MediaPicker: View {
    let kind: MediaKind
    let enabled: Bool
    let scope: any MediaScope
    var compact = false
    let onSelected: @MainActor (MediaFile) async throws -> Void
    @State private var selection: PhotosPickerItem?
    @State private var importing = false
    @State private var failed = false
    var body: some View {
        let isImporting = importing
        return VStack {
            PhotosPicker(selection: $selection, matching: kind == .video ? .videos : .images, preferredItemEncoding: .compatible) {
                if compact {
                    VStack(spacing: 7) {
                        Group {
                            if isImporting { ProgressView() }
                            else { Image(systemName: kind == .video ? "video.fill" : "photo.fill").font(.system(size: 23, weight: .medium)) }
                        }
                        .frame(width: 56, height: 56)
                        .background(AppTheme.accent.opacity(0.1), in: RoundedRectangle(cornerRadius: 18))
                        Text(kind == .video ? "동영상" : "사진").font(.caption.weight(.medium))
                    }.frame(maxWidth: .infinity)
                } else if isImporting { ProgressView() }
                else { Label(kind == .avatar ? "프로필 사진 변경" : kind == .video ? "동영상 선택" : "사진 선택", systemImage: kind == .video ? "video" : "photo") }
            }.disabled(!enabled || importing)
            if !compact {
                Text(kind == .video ? "MP4·MOV · 최대 50MB · 60초" : "JPEG·PNG·WebP · 최대 10MB")
                    .font(.caption).foregroundStyle(.secondary)
            }
            if failed { Text("미디어 작업을 완료하지 못했어요. 다시 시도해 주세요.") }
        }
        .task(id: selection) {
            guard let selection else { return }
            importing = true; failed = false
            defer { importing = false; self.selection = nil }
            var picked: PickedMedia?
            defer { if let picked { try? FileManager.default.removeItem(at: picked.url) } }
            do {
                try scope.check(); picked = try await selection.loadTransferable(type: PickedMedia.self)
                guard let picked else { throw MediaError.invalid }
                try scope.check(); try Task.checkCancellation()
                try await onSelected(MediaFile(url: picked.url, kind: kind, contentType: picked.contentType))
            } catch { if !Task.isCancelled { failed = true } }
        }
    }
}
#endif
