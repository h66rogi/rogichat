import SwiftUI
import RogichatRooms

// List loading/refresh/cursor responsibilities adapted from Meloming's
// NotificationsViewModel. Membership authority and scope fencing are new.
@MainActor @Observable
final class RoomsScreenModel {
    private(set) var state: Loadable<RoomsListing> = .idle
    var listing: RoomsListing? { state.value }
    var loading: Bool { state.isLoading }
    private(set) var loadingMore = false
    private(set) var error: String?
    private var revision = UUID()
    private let repository: RoomsRepository
    private let scope: RoomsScope
    init(repository: RoomsRepository, scope: RoomsScope) { self.repository = repository; self.scope = scope }
    func refresh() async {
        revision = UUID(); let ticket = revision
        let previous = state.value
        state = .loading(previous: previous); error = nil
        defer { if revision == ticket, state.isLoading { state = previous.map(Loadable.loaded) ?? .idle } }
        do {
            let value = try await repository.refresh()
            try scope.check()
            guard ticket == revision, !Task.isCancelled else { return }
            state = .loaded(value)
        } catch {
            guard ticket == revision, !Task.isCancelled else { return }
            self.error = (error as? RoomsError)?.errorDescription ?? (error as? ProductError)?.errorDescription ?? RoomsError.persistence.errorDescription
            if let previous = state.value { state = .loaded(previous) } else { state = .failed(error) }
        }
    }
    func loadMore() async {
        guard !loading, !loadingMore else { return }
        loadingMore = true; let ticket = revision; error = nil
        defer { loadingMore = false }
        do {
            let value = try await repository.loadMore()
            try scope.check()
            guard ticket == revision, !Task.isCancelled else { return }
            state = .loaded(value)
        } catch {
            guard ticket == revision, !Task.isCancelled else { return }
            self.error = (error as? RoomsError)?.errorDescription ?? (error as? ProductError)?.errorDescription ?? RoomsError.persistence.errorDescription
            if let previous = state.value { state = .loaded(previous) } else { state = .failed(error) }
        }
    }
}
struct RoomsScreen: View {
    @State private var model: RoomsScreenModel
    @State private var query = ""
    @Environment(\.scenePhase) private var scenePhase
    init(repository: RoomsRepository, scope: RoomsScope) { _model = State(initialValue: RoomsScreenModel(repository: repository, scope: scope)) }
    var body: some View {
        Group {
            if let listing = model.listing {
                List {
                    if let error = model.error { errorRow(error) }
                    if model.loading { ProgressView("대화방을 확인하는 중").accessibilityLabel("대화방을 확인하는 중") }
                    let joined = listing.memberships.filter { matches($0.name) }
                    let joinedIDs = Set(listing.memberships.map(\.id))
                    let discoverable = listing.discovery.filter { !joinedIDs.contains($0.id) && matches($0.name) }
                    Section("참여 중인 대화방") {
                        if joined.isEmpty {
                            Text(query.isEmpty ? "참여한 대화방이 없어요." : "검색한 대화방이 없어요.").foregroundStyle(.secondary)
                        }
                        ForEach(joined) { room in roomRow(name: room.name, mode: room.mode) }
                    }
                    Section("둘러보기") {
                        ForEach(discoverable) { room in roomRow(name: room.name, mode: room.mode) }
                        if discoverable.isEmpty {
                            Text(query.isEmpty ? "불러온 다른 대화방이 없어요." : "불러온 목록에 검색 결과가 없어요.").foregroundStyle(.secondary)
                        }
                        if !listing.discoveryComplete {
                            if model.loadingMore { ProgressView("대화방을 더 불러오는 중") }
                            else { Button("대화방 더 보기") { Task { await model.loadMore() } }.disabled(model.loading) }
                        }
                    }
                }.listStyle(.insetGrouped)
            } else if let error = model.error {
                ContentUnavailableView {
                    Label("대화방을 불러오지 못했어요", systemImage: "wifi.exclamationmark")
                } description: { Text(error) }
                actions: { Button("다시 시도") { Task { await model.refresh() } }.buttonStyle(.borderedProminent).disabled(model.loading) }
            } else {
                ScreenStatus(title: "대화방을 불러오는 중", message: "", loading: true).frame(maxHeight: .infinity)
            }
        }
        .searchable(text: $query, prompt: "불러온 대화방 검색")
        .task { await model.refresh() }
        .onChange(of: scenePhase) { _, phase in
            if phase == .active, model.listing != nil { Task { await model.refresh() } }
        }
        .refreshable { await model.refresh() }
    }
    private func matches(_ name: String) -> Bool { query.isEmpty || name.localizedCaseInsensitiveContains(query) }
    private func roomRow(name: String, mode: String) -> some View {
        HStack(spacing: 14) {
            Image(systemName: mode == "FAN" ? "bubble.left.and.bubble.right" : "person.2")
                .font(.title3).foregroundStyle(AppTheme.accent)
                .frame(width: 48, height: 48).background(AppTheme.accent.opacity(0.12), in: RoundedRectangle(cornerRadius: 14))
                .accessibilityHidden(true)
            VStack(alignment: .leading, spacing: 5) {
                Text(name).font(.headline).foregroundStyle(.primary)
                Text(mode == "FAN" ? "팬 대화" : "그룹 대화").font(.subheadline).foregroundStyle(.secondary)
            }
        }.padding(.vertical, 5).accessibilityElement(children: .combine)
    }
    private func errorRow(_ message: String) -> some View {
        VStack(alignment: .leading, spacing: 8) {
            Text(message).font(.subheadline)
            Text("이전에 확인한 목록을 표시하고 있어요.").font(.footnote).foregroundStyle(.secondary)
            Button("다시 확인") { Task { await model.refresh() } }.disabled(model.loading)
        }.accessibilityElement(children: .contain)
    }
}
