import SwiftUI

struct RoomSummary: Identifiable, Equatable, Sendable {
    let id: String
    let title: String
    let subtitle: String
}
protocol RoomsServing: Sendable {
    func rooms(for accountID: String) async throws -> [RoomSummary]
}
struct UnavailableRoomsService: RoomsServing {
    func rooms(for accountID: String) async throws -> [RoomSummary] { throw ProductError.unavailable }
}

// Rogichat-specific room navigation; no reference chat/Talk UX is imported.
struct RoomsScreen: View {
    let accountID: String
    let service: any RoomsServing
    let onOpen: ((RoomSummary) -> Void)?
    @State private var state: Loadable<[RoomSummary]> = .idle
    @State private var query = ""
    @State private var reload = 0
    var body: some View {
        LoadableView(state: state) {
            ScreenStatus(title: "대화를 불러오는 중", message: "", loading: true)
        } loaded: { rooms in
            let visible = query.isEmpty ? rooms : rooms.filter { $0.title.localizedCaseInsensitiveContains(query) }
            if rooms.isEmpty {
                ContentUnavailableView("참여한 대화가 없어요", systemImage: "bubble.left.and.bubble.right", description: Text("대화방에 참여하면 여기에 표시돼요."))
            } else if visible.isEmpty {
                ContentUnavailableView.search(text: query)
            } else {
                List(visible) { room in
                    if let onOpen {
                        Button { onOpen(room) } label: { roomRow(room, canOpen: true) }
                    } else {
                        roomRow(room, canOpen: false)
                    }
                }.listStyle(.plain)
            }
        } failed: { error in
            if (error as? ProductError) == .unavailable {
                ContentUnavailableView("대화를 사용할 수 없어요", systemImage: "bubble.left.and.bubble.right")
            } else {
            ContentUnavailableView {
                Label("대화를 불러오지 못했어요", systemImage: "wifi.exclamationmark")
            } description: { Text("연결을 확인하고 다시 시도해 주세요.") }
              actions: { Button("다시 시도") { reload += 1 }.buttonStyle(.borderedProminent) }
            }
        }
        .searchable(text: $query, prompt: "대화 검색")
        .task(id: reload) { await load() }
        .refreshable { await load() }
    }
    private func roomRow(_ room: RoomSummary, canOpen: Bool) -> some View {
        HStack(spacing: 14) {
            Text(String(room.title.prefix(1))).font(.title3.bold())
                .frame(width: 52, height: 52).background(AppTheme.accent.opacity(0.12), in: Circle())
            VStack(alignment: .leading, spacing: 5) {
                Text(room.title).font(.headline).foregroundStyle(.primary)
                Text(room.subtitle).font(.subheadline).foregroundStyle(.secondary).lineLimit(2)
            }
            Spacer(minLength: 4)
            if canOpen { Image(systemName: "chevron.right").font(.caption).foregroundStyle(.tertiary).accessibilityHidden(true) }
        }.padding(.vertical, 6).accessibilityElement(children: .combine)
    }
    private func load() async {
        guard !state.isLoading else { return }
        state = .loading(previous: state.value)
        defer { if Task.isCancelled { state = .idle } }
        do {
            let value = try await service.rooms(for: accountID)
            guard !Task.isCancelled else { return }
            state = .loaded(value)
        } catch {
            guard !Task.isCancelled else { return }
            state = .failed(error)
        }
    }
}
