import SwiftUI
import RogichatRooms

struct RoomsScreen: View {
    @State private var model: RoomsScreenModel
    let onOpenConversation: () -> Void
    @State private var visible = false
    @State private var query = ""
    @State private var discoveryQuery = ""
    @State private var showingDiscovery = false
    @State private var leaving: RoomCommandIntent?
    @Environment(\.scenePhase) private var scenePhase

    init(model: RoomsScreenModel, onOpenConversation: @escaping () -> Void) {
        _model = State(initialValue: model)
        self.onOpenConversation = onOpenConversation
    }

    var body: some View {
        Group {
            if let listing = model.listing {
                let joined = listing.memberships.filter { matches($0.name, query: query) }
                List {
                    if let error = model.error { errorRow(error) }
                    else if model.needsConfirmation { errorRow("참여 상태를 다시 확인해 주세요.") }
                    if let notice = model.notice { Text(notice).font(.footnote).foregroundStyle(.secondary) }
                    if joined.isEmpty {
                        ContentUnavailableView {
                            Label(query.isEmpty ? "아직 대화가 없어요" : "검색 결과가 없어요", systemImage: "bubble.left.and.bubble.right")
                        } description: {
                            Text(query.isEmpty ? "대화를 찾아 참여해 보세요." : "다른 이름으로 검색해 보세요.")
                        } actions: {
                            if query.isEmpty { Button("대화 찾기") { showingDiscovery = true } }
                        }.listRowSeparator(.hidden)
                    }
                    ForEach(joined) { room in
                        Button {
                            Task {
                                if await model.openConversation(roomID: room.id, displayedCycle: listing.cycle) {
                                    onOpenConversation()
                                }
                            }
                        } label: {
                            roomIdentity(name: room.name, mode: room.mode)
                                .frame(maxWidth: .infinity, alignment: .leading)
                                .contentShape(Rectangle())
                        }
                        .buttonStyle(.plain)
                        .disabled(!model.canAct)
                        .accessibilityLabel("\(room.name) 대화 열기")
                        .swipeActions(edge: .trailing, allowsFullSwipe: false) {
                            Button("나가기", role: .destructive) { selectLeave(room, cycle: listing.cycle) }
                                .disabled(!model.canAct)
                        }
                        .contextMenu {
                            Button(role: .destructive) {
                                selectLeave(room, cycle: listing.cycle)
                            } label: {
                                Label("대화에서 나가기", systemImage: "rectangle.portrait.and.arrow.right")
                            }.disabled(!model.canAct)
                        }
                        .accessibilityAction(named: "대화에서 나가기") { selectLeave(room, cycle: listing.cycle) }
                    }
                }
                .listStyle(.plain)
                .searchable(text: $query, prompt: "대화 검색")
                .toolbar {
                    ToolbarItem(placement: .topBarTrailing) {
                        Button { showingDiscovery = true } label: { Image(systemName: "plus.bubble") }
                            .accessibilityLabel("대화 찾기")
                    }
                }
                .sheet(isPresented: $showingDiscovery) { discoverySheet(listing) }
            } else if let error = model.error {
                ContentUnavailableView {
                    Label("대화를 불러오지 못했어요", systemImage: "wifi.exclamationmark")
                } description: { Text(error) }
                actions: { Button("다시 시도") { Task { await model.refresh() } }.buttonStyle(.borderedProminent).disabled(model.loading || model.commandAction != nil) }
            } else {
                ScreenStatus(title: "대화를 불러오는 중", message: "", loading: true).frame(maxHeight: .infinity)
            }
        }
        .task { await model.refreshIfNeeded() }
        .onAppear { visible = true }
        .onDisappear { visible = false }
        .onChange(of: scenePhase) { _, phase in
            if phase == .active, visible, model.listing != nil { Task { await model.refresh() } }
        }
        .refreshable { await model.refresh() }
        .alert("대화에서 나가기", isPresented: Binding(get: { leaving != nil }, set: { if !$0 { leaving = nil } }), presenting: leaving) { intent in
            Button("나가기", role: .destructive) { leaving = nil; model.submit(intent) }
            Button("취소", role: .cancel) { leaving = nil }
        } message: { intent in
            Text("\(intent.roomName)에서 나갈까요? 나가도 보낸 메시지는 삭제되지 않아요.")
        }
    }

    private func discoverySheet(_ listing: RoomsListing) -> some View {
        let joinedIDs = Set(listing.memberships.map(\.id))
        let discoverable = listing.discovery.filter { !joinedIDs.contains($0.id) && matches($0.name, query: discoveryQuery) }
        return NavigationStack {
            List {
                if discoverable.isEmpty {
                    ContentUnavailableView {
                        Label(discoveryQuery.isEmpty ? "참여할 대화가 없어요" : "검색 결과가 없어요",
                              systemImage: "magnifyingglass")
                    } description: {
                        Text(discoveryQuery.isEmpty ? "새 대화가 생기면 여기에 표시돼요." : "다른 이름으로 검색해 보세요.")
                    }.listRowSeparator(.hidden)
                }
                ForEach(discoverable) { room in
                    HStack(spacing: 12) {
                        roomIdentity(name: room.name, mode: room.mode)
                        Spacer(minLength: 8)
                        if room.availability == .ownerPending {
                            Text("방장 확인 대기 중").font(.caption).foregroundStyle(.secondary)
                        } else {
                            Button("참여") {
                                if let intent = model.selection(roomID: room.id, roomName: room.name, displayedCycle: listing.cycle, action: .join, membership: nil) {
                                    showingDiscovery = false
                                    model.submit(intent)
                                }
                            }.buttonStyle(.borderedProminent).disabled(!model.canAct)
                        }
                    }.padding(.vertical, 5)
                }
                if !listing.discoveryComplete {
                    if model.loadingMore { ProgressView("더 불러오는 중") }
                    else { Button("더 보기") { Task { await model.loadMore() } }.disabled(!model.canAct) }
                }
            }
            .listStyle(.plain)
            .searchable(text: $discoveryQuery, prompt: "대화방 검색")
            .navigationTitle("대화 찾기")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar { ToolbarItem(placement: .topBarTrailing) { Button("닫기") { showingDiscovery = false } } }
        }
    }

    private func selectLeave(_ room: MembershipRoom, cycle: String?) {
        leaving = model.selection(roomID: room.id, roomName: room.name, displayedCycle: cycle,
                                  action: .leave, membership: room.membershipScope)
    }

    private func matches(_ name: String, query: String) -> Bool {
        query.isEmpty || name.localizedCaseInsensitiveContains(query)
    }

    private func roomIdentity(name: String, mode: String) -> some View {
        HStack(spacing: 14) {
            Image(systemName: mode == "FAN" ? "bubble.left.and.bubble.right.fill" : "person.2.fill")
                .font(.title3).foregroundStyle(AppTheme.accent)
                .frame(width: 52, height: 52)
                .background(AppTheme.accent.opacity(0.12), in: Circle())
                .accessibilityHidden(true)
            VStack(alignment: .leading, spacing: 4) {
                Text(name).font(.headline).foregroundStyle(.primary).lineLimit(1)
                Text(mode == "FAN" ? "팬 대화" : "그룹 대화")
                    .font(.subheadline).foregroundStyle(.secondary)
            }
        }.padding(.vertical, 7)
    }

    private func errorRow(_ message: String) -> some View {
        HStack(spacing: 12) {
            Text(message).font(.subheadline).frame(maxWidth: .infinity, alignment: .leading)
            Button("다시 시도") { Task { await model.refresh() } }
                .disabled(model.loading || model.commandAction != nil)
        }.accessibilityElement(children: .contain)
    }
}
