#if canImport(UIKit)
import SwiftUI

struct StickerPicker: View {
    let client: MediaClient
    let sending: Bool
    let onSelect: @MainActor (MediaSticker) async throws -> Void
    @State private var items: [MediaSticker] = []
    @State private var cursor: String?
    @State private var loaded = false
    @State private var loading = false
    @State private var selectedID: String?
    @State private var loadFailed = false
    @State private var sendFailed = false
    @State private var operation: Task<Void, Never>?
    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            HStack {
                Text("스티커").font(.subheadline.weight(.semibold))
                Spacer()
                if loading { ProgressView().controlSize(.small) }
            }
            .padding(.horizontal, 18).padding(.vertical, 12)
            Divider()
            if loadFailed {
                HStack {
                    Text("스티커를 불러오지 못했어요.").font(.footnote)
                    Spacer()
                    Button("다시 시도") { operation = Task { await load() } }
                        .disabled(loading || selectedID != nil)
                }
                .padding(.horizontal, 18).padding(.vertical, 8)
            }
            if sendFailed {
                Text("스티커를 보내지 못했어요. 다시 선택해 주세요.")
                    .font(.footnote)
                    .padding(.horizontal, 18).padding(.vertical, 8)
            }
            if loaded && items.isEmpty {
                ContentUnavailableView("사용할 수 있는 스티커가 없어요", systemImage: "face.smiling")
                    .frame(maxWidth: .infinity, maxHeight: .infinity)
            } else {
                ScrollView {
                    LazyVGrid(columns: Array(repeating: GridItem(.flexible(), spacing: 8), count: 4), spacing: 10) {
                        ForEach(items) { item in
                            if let room = client.scope.roomID {
                                Button {
                                    operation = Task {
                                        selectedID = item.id; sendFailed = false
                                        defer { selectedID = nil }
                                        do { try client.scope.check(); try await onSelect(item) }
                                        catch { if !Task.isCancelled { sendFailed = true } }
                                    }
                                } label: {
                                    AuthorizedMedia(client: client, assetID: item.assetId,
                                                    access: .sticker(room: room, sticker: item.id, message: nil))
                                        .frame(height: 66)
                                        .frame(maxWidth: .infinity)
                                        .contentShape(Rectangle())
                                }
                                .buttonStyle(.plain)
                                .disabled(sending || selectedID != nil)
                                .accessibilityLabel(item.label)
                                .accessibilityHint("두 번 탭하여 대화에 보냅니다")
                            }
                        }
                    }
                    if loaded && cursor != nil {
                        Button("스티커 더 보기") { operation = Task { await load() } }
                            .font(.subheadline.weight(.medium))
                            .frame(maxWidth: .infinity)
                            .padding(.vertical, 12)
                            .disabled(loading)
                    }
                }
                .padding(.horizontal, 16).padding(.vertical, 12)
            }
        }
        .background(Color(uiColor: .systemBackground))
        .task { await load() }
        .onDisappear { operation?.cancel() }
    }
    private func load() async {
        guard !loading else { return }
        loading = true; loadFailed = false; defer { loading = false }
        do {
            let page = try await client.stickers(after: loaded ? cursor : nil)
            guard page.nextCursor == nil || page.nextCursor != cursor else { throw MediaError.invalid }
            try client.scope.check()
            var ids = Set(items.map(\.id)); items += page.items.filter { ids.insert($0.id).inserted }
            cursor = page.nextCursor; loaded = true
        } catch { if !Task.isCancelled { loadFailed = true } }
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
