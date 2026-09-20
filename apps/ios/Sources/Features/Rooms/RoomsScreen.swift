import SwiftUI
import RogichatRooms

struct RoomsScreen: View {
    @State private var model: RoomsScreenModel
    @State private var query = ""
    @State private var leaving: RoomCommandIntent?
    @Environment(\.scenePhase) private var scenePhase
    init(model: RoomsScreenModel) { _model = State(initialValue: model) }
    var body: some View {
        Group {
            if let listing = model.listing {
                List {
                    if let error = model.error { errorRow(error) }
                    else if model.needsConfirmation { errorRow("참여 상태를 다시 확인해 주세요.") }
                    if let notice = model.notice { Text(notice).font(.footnote).foregroundStyle(.secondary) }
                    if let action = model.commandAction { ProgressView(action == .join ? "참여 요청과 현재 상태를 확인하는 중" : "나가기 요청과 현재 상태를 확인하는 중") }
                    if model.loading { ProgressView("대화방을 확인하는 중").accessibilityLabel("대화방을 확인하는 중") }
                    let joined = listing.memberships.filter { matches($0.name) }
                    let joinedIDs = Set(listing.memberships.map(\.id))
                    let discoverable = listing.discovery.filter { !joinedIDs.contains($0.id) && matches($0.name) }
                    Section("참여 중인 대화방") {
                        if joined.isEmpty {
                            Text(query.isEmpty ? "참여한 대화방이 없어요." : "검색한 대화방이 없어요.").foregroundStyle(.secondary)
                        }
                        ForEach(joined) { room in
                            roomRow(name: room.name, mode: room.mode) {
                                Button("나가기", role: .destructive) {
                                    leaving = model.selection(roomID: room.id, roomName: room.name, displayedCycle: listing.cycle, action: .leave, membership: room.membershipScope)
                                }.buttonStyle(.borderless).disabled(!model.canAct).accessibilityLabel("\(room.name)에서 나가기")
                            }
                        }
                    }
                    Section("둘러보기") {
                        ForEach(discoverable) { room in
                            roomRow(name: room.name, mode: room.mode) {
                                Button("참여") {
                                    if let intent = model.selection(roomID: room.id, roomName: room.name, displayedCycle: listing.cycle, action: .join, membership: nil) { model.submit(intent) }
                                }.buttonStyle(.bordered).disabled(!model.canAct).accessibilityLabel("\(room.name)에 참여")
                            }
                        }
                        if discoverable.isEmpty {
                            Text(query.isEmpty ? "불러온 다른 대화방이 없어요." : "불러온 목록에 검색 결과가 없어요.").foregroundStyle(.secondary)
                        }
                        if !listing.discoveryComplete {
                            if model.loadingMore { ProgressView("대화방을 더 불러오는 중") }
                            else { Button("대화방 더 보기") { Task { await model.loadMore() } }.disabled(!model.canAct) }
                        }
                    }
                }.listStyle(.insetGrouped)
            } else if let error = model.error {
                ContentUnavailableView {
                    Label("대화방을 불러오지 못했어요", systemImage: "wifi.exclamationmark")
                } description: { Text(error) }
                actions: { Button("다시 시도") { Task { await model.refresh() } }.buttonStyle(.borderedProminent).disabled(model.loading || model.commandAction != nil) }
            } else {
                ScreenStatus(title: "대화방을 불러오는 중", message: "", loading: true).frame(maxHeight: .infinity)
            }
        }
        .searchable(text: $query, prompt: "불러온 대화방 검색")
        .task { await model.refreshIfNeeded() }
        .onChange(of: scenePhase) { _, phase in
            if phase == .active, model.listing != nil { Task { await model.refresh() } }
        }
        .refreshable { await model.refresh() }
        // Selected-row presenting alert adapted from Meloming MyReviewsView.
        .alert("대화에서 나가기", isPresented: Binding(get: { leaving != nil }, set: { if !$0 { leaving = nil } }), presenting: leaving) { intent in
            Button("나가기", role: .destructive) { leaving = nil; model.submit(intent) }
            Button("취소", role: .cancel) { leaving = nil }
        } message: { intent in
            Text("\(intent.roomName)에서 나갈까요? 나가도 보낸 메시지는 삭제되지 않아요.")
        }
    }
    private func matches(_ name: String) -> Bool { query.isEmpty || name.localizedCaseInsensitiveContains(query) }
    private func roomRow<Action: View>(name: String, mode: String, @ViewBuilder action: () -> Action) -> some View {
        VStack(alignment: .leading, spacing: 12) {
            HStack(spacing: 14) {
                Image(systemName: mode == "FAN" ? "bubble.left.and.bubble.right" : "person.2")
                    .font(.title3).foregroundStyle(AppTheme.accent)
                    .frame(width: 48, height: 48).background(AppTheme.accent.opacity(0.12), in: RoundedRectangle(cornerRadius: 14))
                    .accessibilityHidden(true)
                VStack(alignment: .leading, spacing: 5) {
                    Text(name).font(.headline).foregroundStyle(.primary)
                    Text(mode == "FAN" ? "팬 대화" : "그룹 대화").font(.subheadline).foregroundStyle(.secondary)
                }
            }
            action().frame(maxWidth: .infinity, alignment: .trailing)
        }.padding(.vertical, 5).accessibilityElement(children: .contain)
    }
    private func errorRow(_ message: String) -> some View {
        VStack(alignment: .leading, spacing: 8) {
            Text(message).font(.subheadline)
            Text("이전에 확인한 목록을 표시하고 있어요.").font(.footnote).foregroundStyle(.secondary)
            Button("참여 상태 다시 확인") { Task { await model.refresh() } }.disabled(model.loading || model.commandAction != nil)
        }.accessibilityElement(children: .contain)
    }
}
