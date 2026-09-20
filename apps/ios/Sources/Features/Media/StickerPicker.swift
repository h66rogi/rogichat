#if canImport(UIKit)
import SwiftUI

struct StickerPicker: View {
    let client: MediaClient
    let onSelect: @MainActor (MediaContent) async throws -> Void
    @State private var items: [MediaSticker] = []
    @State private var cursor: String?
    @State private var loaded = false
    @State private var busy = false
    @State private var failed = false
    @State private var operation: Task<Void, Never>?
    var body: some View {
        VStack {
            if busy { ProgressView() }
            if failed { Text("스티커를 불러오거나 선택하지 못했어요."); Button("다시 시도") { operation = Task { await load() } }.disabled(busy) }
            if loaded && items.isEmpty { Text("사용할 수 있는 스티커가 없어요.") }
            List(items) { item in
                if let room = client.scope.roomID {
                    AuthorizedMedia(client: client, assetID: item.assetId, access: .sticker(room: room, sticker: item.id, message: nil))
                        .frame(width: 72, height: 72)
                }
                Button(item.label) {
                    operation = Task {
                        busy = true; defer { busy = false }
                        do { try client.scope.check(); try await onSelect(.sticker(item.id)) }
                        catch { if !Task.isCancelled { failed = true } }
                    }
                }.disabled(busy)
            }
            if loaded && cursor != nil { Button("더 보기") { operation = Task { await load() } }.disabled(busy) }
        }
        .task { await load() }
        .onDisappear { operation?.cancel() }
    }
    private func load() async {
        busy = true; failed = false; defer { busy = false }
        do {
            let page = try await client.stickers(after: loaded ? cursor : nil)
            guard page.nextCursor == nil || page.nextCursor != cursor else { throw MediaError.invalid }
            try client.scope.check()
            var ids = Set(items.map(\.id)); items += page.items.filter { ids.insert($0.id).inserted }
            cursor = page.nextCursor; loaded = true
        } catch { if !Task.isCancelled { failed = true } }
    }
}
struct AvatarPicker: View {
    let client: MediaClient
    let journal: any MediaJournal
    let onUpdated: @MainActor () async throws -> Void
    @State private var busy = false
    var body: some View {
        MediaPicker(kind: .avatar, enabled: !busy, scope: client.scope) { file in
            busy = true; defer { busy = false }
            let upload = MediaUpload(client: client, journal: journal)
            let ready = try await upload.start(file)
            try await client.updateAvatar(ready); try client.scope.check()
            try await upload.acknowledged(ready.assetId); try await onUpdated()
        }
    }
}
#endif
