import SwiftUI
import RogichatRooms

private enum RoomFilter: String, CaseIterable {
    case all = "전체"
    case fan = "팬 대화"
    case group = "그룹 대화"

    func includes(_ mode: String) -> Bool {
        switch self {
        case .all: true
        case .fan: mode == "FAN"
        case .group: mode == "GROUP"
        }
    }
}

struct RoomsScreen: View {
    @State private var model: RoomsScreenModel
    let onOpenConversation: () -> Void
    let onOpenSettings: () -> Void
    @State private var visible = false
    @State private var query = ""
    @State private var discoveryQuery = ""
    @State private var showingSearch = false
    @State private var showingDiscovery = false
    @State private var filter: RoomFilter = .all
    @Environment(\.scenePhase) private var scenePhase

    init(model: RoomsScreenModel, onOpenConversation: @escaping () -> Void,
         onOpenSettings: @escaping () -> Void) {
        _model = State(initialValue: model)
        self.onOpenConversation = onOpenConversation
        self.onOpenSettings = onOpenSettings
    }

    var body: some View {
        VStack(spacing: 0) {
            header
            if let listing = model.listing {
                let joined = listing.memberships.filter {
                    filter.includes($0.mode) && (query.isEmpty || $0.name.localizedCaseInsensitiveContains(query))
                }
                VStack(spacing: 0) {
                    filters
                    if showingSearch {
                        HStack {
                            Image(systemName: "magnifyingglass").foregroundStyle(.secondary)
                            TextField("대화 검색", text: $query).textInputAutocapitalization(.never)
                            if !query.isEmpty {
                                Button { query = "" } label: { Image(systemName: "xmark.circle.fill") }
                                    .accessibilityLabel("검색어 지우기")
                            }
                        }
                        .padding(.horizontal, 14).padding(.vertical, 11)
                        .background(Color(uiColor: .secondarySystemBackground), in: RoundedRectangle(cornerRadius: 12))
                        .padding(.horizontal, 20).padding(.bottom, 10)
                    }
                    ScrollView {
                        LazyVStack(spacing: 0) {
                            if let error = model.error { errorBanner(error) }
                            else if model.needsConfirmation { errorBanner("대화 참여 상태를 다시 확인해 주세요.") }
                            if let notice = model.notice {
                                Text(notice).font(.footnote).foregroundStyle(.secondary)
                                    .frame(maxWidth: .infinity, alignment: .leading)
                                    .padding(.horizontal, 20).padding(.vertical, 12)
                            }
                            if joined.isEmpty {
                                ContentUnavailableView {
                                    Label(query.isEmpty && filter == .all ? "아직 대화가 없어요" : "검색 결과가 없어요",
                                          systemImage: "bubble.left.and.bubble.right")
                                } description: {
                                    Text(query.isEmpty && filter == .all ? "대화를 찾아 참여해 보세요." : "다른 대화를 찾아보세요.")
                                } actions: {
                                    if query.isEmpty && filter == .all { Button("대화 찾기") { showingDiscovery = true } }
                                }.padding(.top, 72)
                            }
                            ForEach(joined) { room in
                                Button {
                                    Task {
                                        if await model.openConversation(roomID: room.id, displayedCycle: listing.cycle) {
                                            onOpenConversation()
                                        }
                                    }
                                } label: { roomRow(name: room.name, mode: room.mode) }
                                .buttonStyle(.plain)
                                .disabled(!model.canAct)
                                .accessibilityLabel("\(room.name) 대화 열기")
                            }
                        }
                    }
                    .refreshable { await model.refresh() }
                }
                .background(Color(uiColor: .systemBackground))
                .sheet(isPresented: $showingDiscovery) { discoverySheet(listing) }
            } else if let error = model.error {
                ContentUnavailableView {
                    Label("대화를 불러오지 못했어요", systemImage: "wifi.exclamationmark")
                } description: { Text(error) }
                actions: { Button("다시 시도") { Task { await model.refresh() } }.buttonStyle(.borderedProminent) }
                .frame(maxWidth: .infinity, maxHeight: .infinity)
            } else {
                ScreenStatus(title: "대화를 불러오는 중", message: "", loading: true).frame(maxHeight: .infinity)
            }
        }
        .toolbar(.hidden, for: .navigationBar)
        .task { await model.refreshIfNeeded() }
        .onAppear { visible = true }
        .onDisappear { visible = false }
        .onChange(of: scenePhase) { _, phase in
            if phase == .active, visible, model.listing != nil { Task { await model.refresh() } }
        }
    }

    private var header: some View {
        TopLevelTabHeader(title: "채팅") {
            Button { showingSearch.toggle(); if !showingSearch { query = "" } } label: {
                Image(systemName: "magnifyingglass").font(.title3)
            }.accessibilityLabel("대화 검색")
            Button { showingDiscovery = true } label: {
                Image(systemName: "plus.bubble").font(.title3)
            }.accessibilityLabel("새 대화 찾기")
            Button(action: onOpenSettings) {
                Image(systemName: "gearshape").font(.title3)
            }.accessibilityLabel("설정")
        }
    }

    private var filters: some View {
        ScrollView(.horizontal, showsIndicators: false) {
            HStack(spacing: 8) {
                ForEach(RoomFilter.allCases, id: \.self) { choice in
                    Button { filter = choice } label: {
                        Text(choice.rawValue)
                            .font(.subheadline.weight(filter == choice ? .semibold : .medium))
                            .foregroundStyle(filter == choice ? Color(uiColor: .systemBackground) : .primary)
                            .padding(.horizontal, 17).frame(height: 38)
                            .background(filter == choice ? Color.primary : Color(uiColor: .secondarySystemBackground),
                                        in: Capsule())
                    }.buttonStyle(.plain).accessibilityAddTraits(filter == choice ? .isSelected : [])
                }
            }.padding(.horizontal, 20)
        }.padding(.bottom, 12)
    }

    private func roomRow(name: String, mode: String) -> some View {
        HStack(spacing: 14) {
            Image(systemName: mode == "FAN" ? "bubble.left.and.bubble.right.fill" : "person.2.fill")
                .font(.system(size: 24, weight: .medium))
                .foregroundStyle(AppTheme.accent)
                .frame(width: 56, height: 56)
                .background(AppTheme.accent.opacity(0.16), in: Circle())
                .accessibilityHidden(true)
            VStack(alignment: .leading, spacing: 5) {
                Text(name).font(.system(size: 17, weight: .semibold)).foregroundStyle(.primary).lineLimit(1)
                Text(mode == "FAN" ? "팬 대화" : "그룹 대화")
                    .font(.subheadline).foregroundStyle(.secondary).lineLimit(1)
            }
            Spacer(minLength: 8)
        }
        .frame(maxWidth: .infinity, minHeight: 78, alignment: .leading)
        .padding(.horizontal, 22)
        .contentShape(Rectangle())
    }

    private func discoverySheet(_ listing: RoomsListing) -> some View {
        let joinedIDs = Set(listing.memberships.map(\.id))
        let discoverable = listing.discovery.filter {
            !joinedIDs.contains($0.id) && (discoveryQuery.isEmpty || $0.name.localizedCaseInsensitiveContains(discoveryQuery))
        }
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
                        Text(room.name).font(.headline)
                        Spacer(minLength: 8)
                        if room.availability == .ownerPending {
                            Text("방장 확인 대기 중").font(.caption).foregroundStyle(.secondary)
                        } else {
                            Button("참여") {
                                if let intent = model.selection(roomID: room.id, roomName: room.name, displayedCycle: listing.cycle,
                                                                 action: .join, membership: nil) {
                                    showingDiscovery = false
                                    model.submit(intent)
                                }
                            }.buttonStyle(.borderedProminent).disabled(!model.canAct)
                        }
                    }.padding(.vertical, 10)
                }
                if !listing.discoveryComplete {
                    if model.loadingMore { ProgressView("더 불러오는 중") }
                    else { Button("더 보기") { Task { await model.loadMore() } }.disabled(!model.canAct) }
                }
            }
            .searchable(text: $discoveryQuery, prompt: "대화방 검색")
            .navigationTitle("대화 찾기")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar { ToolbarItem(placement: .topBarTrailing) { Button("닫기") { showingDiscovery = false } } }
        }
    }

    private func errorBanner(_ message: String) -> some View {
        HStack(spacing: 12) {
            Text(message).font(.subheadline).frame(maxWidth: .infinity, alignment: .leading)
            Button("다시 시도") { Task { await model.refresh() } }
                .disabled(model.loading || model.commandAction != nil)
        }.padding(.horizontal, 20).padding(.vertical, 10)
    }
}
