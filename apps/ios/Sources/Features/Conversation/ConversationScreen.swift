import SwiftUI
import RogichatRooms

struct ConversationScreen: View {
    // A long message can be taller than the viewport, so use a small visible fraction.
    private static let messageVisibilityThreshold = 0.001
    private struct ProjectionSignal: Equatable {
        let messages: [ConversationMessage]?
        let historyRevision: Int
    }
    @State private var model: ConversationScreenModel
    @State private var features: ConversationFeatureModel?
    @State private var showMedia = false
    @State private var showCamera = false
    @State private var cameraError = false
    @State private var mediaAfterCamera = false
    @State private var cameraErrorAfterDismiss = false
    @State private var showStickers = false
    @State private var showAttachments = false
    @State private var showActions = false
    @State private var confirmLeave = false
    @State private var leaveError: String?
    @State private var openedMedia: OpenedConversationMedia?
    @State private var visibleIDs: [String] = []
    @State private var quoteTarget: String?
    @State private var quoteNotice: String?
    @State private var quoteAttemptedCursor: String?
    @State private var unreadScrollTarget: String?
    @State private var unreadAttemptedCursor: String?
    @State private var unreadFailedCursor: String?
    @State private var unreadExhaustedCursor: String?
    @State private var unreadReady = false
    @State private var projectedSignal: ProjectionSignal?
    @State private var userNavigated = false
    @State private var atLatest = true
    @State private var visible = false
    @FocusState private var composing: Bool
    @Environment(\.scenePhase) private var scenePhase
    let onReopen: () -> Void
    let onLeave: () async -> String?
    init(model: ConversationScreenModel, session: AppSession, environment: String, accountID: String,
         targetMessageID: String? = nil,
         onReopen: @escaping () -> Void, onLeave: @escaping () async -> String?) {
        _model = State(initialValue: model)
        _features = State(initialValue: try? ConversationFeatureModel(conversation: model, session: session, environment: environment, accountID: accountID))
        self.onReopen = onReopen
        self.onLeave = onLeave
        self.targetMessageID = targetMessageID
    }
    let targetMessageID: String?
    var body: some View {
        VStack(spacing: 0) {
            if let error = features?.error { Text(error).font(.footnote).foregroundStyle(.secondary).padding(.horizontal).accessibilityAddTraits(.updatesFrequently) }
            if let error = model.error {
                VStack(alignment: .leading, spacing: 6) {
                    Text(error).font(.subheadline)
                    Button(model.active ? "다시 확인" : "대화방 목록 다시 확인") {
                        if model.active { Task { await model.refresh() } } else { onReopen() }
                    }.disabled(model.loading || model.sending)
                }.frame(maxWidth: .infinity, alignment: .leading).padding().background(.regularMaterial)
                .accessibilityElement(children: .contain)
            }
            if let quoteNotice {
                HStack(spacing: 8) {
                    Text(quoteNotice).font(.footnote).foregroundStyle(.secondary)
                    Spacer(minLength: 8)
                    Button("닫기") { self.quoteNotice = nil }.font(.footnote)
                }
                .padding(.horizontal, 16).padding(.vertical, 8)
                .accessibilityAddTraits(.updatesFrequently)
            }
            if let listing = model.listing, model.active {
                timeline(listing)
            } else if model.loading || model.error == nil {
                ScreenStatus(title: "대화를 불러오는 중", message: "", loading: true).frame(maxHeight: .infinity)
            } else { Spacer() }
        }
        .background(Color(uiColor: .systemBackground))
        .navigationTitle(model.scope.room.name)
        .navigationBarTitleDisplayMode(.inline)
        .toolbar(.visible, for: .navigationBar)
        .toolbar(.hidden, for: .tabBar)
        .toolbar { ToolbarItem(placement: .topBarTrailing) {
            Menu {
                Button("새로고침", systemImage: "arrow.clockwise") { Task { await model.refresh() } }
                Button(role: .destructive) {
                    confirmLeave = true
                } label: { Label(model.scope.room.role == "STREAMER" ? "채팅방 삭제" : "대화에서 나가기", systemImage: "rectangle.portrait.and.arrow.right") }
            } label: { Image(systemName: "line.3.horizontal") }
                .accessibilityLabel("대화 메뉴")
                .disabled(!model.active || model.loading || model.sending || model.checking)
        } }
        .confirmationDialog(model.scope.room.role == "STREAMER" ? "채팅방을 삭제할까요?" : "대화에서 나갈까요?", isPresented: $confirmLeave, titleVisibility: .visible) {
            Button(model.scope.room.role == "STREAMER" ? "채팅방 삭제" : "나가기", role: .destructive) {
                Task {
                    if let error = await onLeave() { leaveError = error }
                }
            }
            Button("취소", role: .cancel) {}
        } message: {
            Text(model.scope.room.role == "STREAMER" ? "방장이 나가면 모든 참여자가 이 대화와 첨부를 더 이상 볼 수 없어요. 되돌릴 수 없습니다." : "나가도 보낸 메시지는 삭제되지 않아요.")
        }
        .alert("대화에서 나가지 못했어요", isPresented: Binding(get: { leaveError != nil }, set: { if !$0 { leaveError = nil } })) {
            Button("확인") { leaveError = nil }
        } message: { Text(leaveError ?? "") }
        .safeAreaInset(edge: .bottom, spacing: 0) { if model.active, model.listing?.ready == true { composer } }
        .task {
            await model.load()
            if let targetMessageID { userNavigated = true; quoteAttemptedCursor = nil; quoteTarget = targetMessageID }
            applyProjection()
            await features?.load()
        }
        .onChange(of: targetMessageID) { _, value in
            if let value { userNavigated = true; quoteAttemptedCursor = nil; quoteTarget = value }
        }
        .onChange(of: projectionSignal) { _, _ in applyProjection() }
        .onChange(of: model.active) { _, active in
            if !active {
                features?.close(); showActions = false; showMedia = false; openedMedia = nil
                showCamera = false; showStickers = false; showAttachments = false
                quoteTarget = nil; unreadScrollTarget = nil; unreadReady = false; visibleIDs = []
                unreadExhaustedCursor = nil
            }
        }
        .onChange(of: composing) { _, focused in if focused { showAttachments = false; showStickers = false } }
        .onAppear { visible = true }
        .onDisappear { visible = false }
        .task(id: scenePhase == .active) {
            guard scenePhase == .active else { return }
            while !Task.isCancelled {
                do { try await Task.sleep(for: .seconds(Double.random(in: 12...18))) } catch { return }
                guard !Task.isCancelled, scenePhase == .active else { return }
                await model.poll()
            }
        }
        .onChange(of: scenePhase) { _, phase in if phase == .active, visible { Task { await model.poll() } } }
        .sheet(isPresented: $showMedia) { mediaSheet }
        .sheet(isPresented: $showCamera, onDismiss: {
            if mediaAfterCamera { mediaAfterCamera = false; if model.active { showMedia = true } }
            if cameraErrorAfterDismiss { cameraErrorAfterDismiss = false; cameraError = true }
        }) {
            if let features {
                CameraCapture(scope: features.mediaScope) { file in
                    mediaAfterCamera = true
                    showCamera = false
                    try? await features.upload(file)
                } onCancel: {
                    showCamera = false
                } onFailure: {
                    showCamera = false
                    cameraErrorAfterDismiss = true
                }
                .ignoresSafeArea()
            }
        }
        .alert("사진을 사용할 수 없어요", isPresented: $cameraError) {
            Button("확인", role: .cancel) {}
        } message: { Text("다시 촬영하거나 사진을 선택해 주세요.") }
        .sheet(isPresented: $showActions, onDismiss: { features?.dismissActions() }) {
            if let features, let token = features.token { ConversationActionsSheet(features: features, token: token, onClose: { showActions = false }) }
        }
        .fullScreenCover(item: $openedMedia) { selected in
            if let features, model.active, model.listing?.messages.contains(where: { message in
                guard message.id == selected.messageID else { return false }
                switch message.content {
                case .photo(let items, _): return selected.variant == .image && items.contains { $0.assetId == selected.assetID }
                case .video(let items, _): return selected.variant == .video && items.contains { $0.assetId == selected.assetID }
                default: return false
                }
            }) == true {
                ZStack {
                    Color.black.ignoresSafeArea()
                    AuthorizedMedia(client: features.media, assetID: selected.assetID,
                        access: .message(room: model.scope.room.id, message: selected.messageID, variant: selected.variant),
                        zoomable: selected.variant == .image)
                        .frame(maxWidth: .infinity, maxHeight: .infinity)
                }
                .overlay(alignment: .topTrailing) {
                    Button("닫기") { openedMedia = nil }
                        .font(.headline).foregroundStyle(.white).padding(12)
                        .background(.black.opacity(0.7), in: Capsule()).padding()
                }
                .accessibilityLabel(selected.variant == .video ? "동영상 크게 보기" : "사진 크게 보기")
            } else { Color.black.ignoresSafeArea().onAppear { openedMedia = nil } }
        }
    }
    private func timeline(_ listing: ConversationListing) -> some View {
        ScrollViewReader { proxy in timelineNavigation(listing, proxy: proxy) }
    }
    private func timelineNavigation(_ listing: ConversationListing, proxy: ScrollViewProxy) -> some View {
        timelineKeyboard(listing, proxy: proxy)
        .onChange(of: features?.move) { _, move in
            switch move {
            case .latest: withAnimation { proxy.scrollTo("conversation-bottom", anchor: .bottom) }
            case .restore(let anchor): proxy.scrollTo(anchor.messageId, anchor: .top)
            default: break
            }
            features?.consumedMove()
        }
        .onChange(of: quoteTarget) { _, _ in resolveQuote(proxy) }
        .onChange(of: model.listing?.messages) { _, _ in resolveQuote(proxy) }
        .onChange(of: features?.firstUnreadMessageId) { _, _ in
            if !unreadReady && !userNavigated {
                unreadScrollTarget = nil; unreadAttemptedCursor = nil
                unreadFailedCursor = nil; unreadExhaustedCursor = nil
                resolveFirstUnread(proxy)
            }
        }
        .onChange(of: features?.readStateReady) { _, _ in
            resolveFirstUnread(proxy); reportVisibleMessages()
        }
        .onChange(of: model.listing?.messages) { _, _ in resolveFirstUnread(proxy) }
        .onChange(of: model.listing?.historyCursor) { _, _ in
            resolveQuote(proxy); resolveFirstUnread(proxy)
        }
        .onChange(of: model.canLoadHistory) { _, canLoad in
            if canLoad { resolveQuote(proxy); resolveFirstUnread(proxy) }
        }
        .onChange(of: unreadExhaustedCursor) { _, _ in resolveFirstUnread(proxy) }
        .onChange(of: model.error) { _, error in
            if error == nil {
                unreadFailedCursor = nil; unreadAttemptedCursor = nil
                resolveFirstUnread(proxy)
            }
        }
        .onChange(of: userNavigated) { _, navigated in if navigated { reportVisibleMessages() } }
        .onChange(of: unreadReady) { _, ready in if ready { reportVisibleMessages() } }
    }
    private func timelineKeyboard(_ listing: ConversationListing, proxy: ScrollViewProxy) -> some View {
        timelineScroll(listing, proxy: proxy)
        .onChange(of: composing) { _, focused in
            if focused { scrollToLatest(proxy) }
        }
        .onChange(of: model.draft) { _, _ in
            if composing { scrollToLatest(proxy) }
        }
        .onChange(of: showStickers) { _, open in
            if open { scrollToLatest(proxy) }
        }
        .onChange(of: model.sending) { _, sending in
            if sending {
                features?.latest()
                scrollToLatest(proxy, animated: true)
            }
        }
        .onChange(of: model.listing?.commands) { _, _ in
            if model.sending { scrollToLatest(proxy, animated: true) }
        }
    }
    private func timelineScroll(_ listing: ConversationListing, proxy: ScrollViewProxy) -> some View {
        ScrollView { timelineRows(listing, proxy: proxy) }
        .defaultScrollAnchor(.bottom, for: .initialOffset)
        .scrollDismissesKeyboard(.interactively)
        .onScrollPhaseChange { _, phase in
            if phase == .tracking || phase == .interacting { userNavigated = true }
        }
        .onScrollTargetVisibilityChange(idType: String.self, threshold: Self.messageVisibilityThreshold) { ids in
            updateVisibleMessages(ids, listing: listing)
        }
        .onScrollGeometryChange(for: Bool.self) { geometry in
            geometry.contentOffset.y + geometry.containerSize.height >= geometry.contentSize.height - 48
        } action: { _, value in
            updateLatestPosition(value)
        }
        .onScrollGeometryChange(for: CGSize.self) { $0.containerSize } action: { _, _ in
            if composing || showStickers { scrollToLatest(proxy) }
        }
    }
    private func timelineRows(_ listing: ConversationListing, proxy: ScrollViewProxy) -> some View {
        LazyVStack(spacing: 4) {
            if listing.historyCursor != nil {
                if model.loadingHistory { ProgressView("이전 메시지를 불러오는 중") }
                else { Button("이전 메시지 보기") { userNavigated = true; Task { await model.history() } }.disabled(model.loading || model.checking || model.sending) }
            }
            if listing.ready && listing.messages.isEmpty && listing.commands.isEmpty {
                ContentUnavailableView("아직 메시지가 없어요", systemImage: "bubble.left.and.bubble.right", description: Text("이 대화에서 볼 수 있는 메시지가 여기에 표시돼요."))
                    .padding(.top, 24)
            }
            ForEach(Array(listing.messages.enumerated()), id: \.element.id) { index, message in
                let previous = index > 0 ? listing.messages[index - 1] : nil
                let next = index + 1 < listing.messages.count ? listing.messages[index + 1] : nil
                if !sameDay(previous, message) {
                    Text(day(message.createdAt))
                        .font(.caption.weight(.medium))
                        .foregroundStyle(.secondary)
                        .padding(.horizontal, 14).padding(.vertical, 6)
                        .background(Color(uiColor: .tertiarySystemFill), in: Capsule())
                        .frame(maxWidth: .infinity)
                        .padding(.vertical, 16)
                }
                if message.id == features?.firstUnreadMessageId {
                    Text("여기부터 읽지 않은 메시지")
                        .font(.caption.weight(.semibold)).foregroundStyle(AppTheme.accent)
                        .frame(maxWidth: .infinity).padding(.vertical, 8)
                }
                messageRow(message, beginsGroup: !sameGroup(previous, message), endsGroup: !sameGroup(message, next),
                    onQuoteNavigate: {
                        composing = false; showStickers = false
                        userNavigated = true; quoteAttemptedCursor = nil; quoteTarget = $0; quoteNotice = nil
                        resolveQuote(proxy)
                    })
                    .padding(.top, sameGroup(previous, message) ? 0 : 12)
                    .id(message.id)
                    .onScrollVisibilityChange(threshold: Self.messageVisibilityThreshold) { isVisible in
                        guard isVisible else { features?.noLongerVisible(message.id); return }
                        if message.id == unreadScrollTarget && !unreadReady {
                            unreadReady = true; reportVisibleMessages()
                        }
                        if let features { Task { await features.loadReaction(message) } }
                    }
            }
            ForEach(listing.commands.filter { [.queued, .sending, .unknown, .rejected, .blocked].contains($0.phase) }) { command in
                commandRow(command).id(command.id)
            }
            Color.clear.frame(height: 1).id("conversation-bottom")
        }.scrollTargetLayout().padding(.horizontal, 16).padding(.vertical, 16)
    }
    private func scrollToLatest(_ proxy: ScrollViewProxy, animated: Bool = false) {
        Task { @MainActor in
            await Task.yield()
            if animated {
                withAnimation(.easeOut(duration: 0.25)) {
                    proxy.scrollTo("conversation-bottom", anchor: .bottom)
                }
            } else {
                proxy.scrollTo("conversation-bottom", anchor: .bottom)
            }
        }
    }
    private var projectionSignal: ProjectionSignal {
        ProjectionSignal(messages: model.listing?.messages, historyRevision: model.historyRevision)
    }
    private func applyProjection() {
        guard let listing = model.listing else { return }
        let signal = projectionSignal
        guard signal != projectedSignal else { return }
        let history = signal.historyRevision != projectedSignal?.historyRevision && projectedSignal != nil
        projectedSignal = signal
        features?.projectionChanged(listing, history: history)
    }
    private var canReportVisible: Bool {
        guard let features, features.readStateReady else { return false }
        return features.firstUnreadMessageId == nil || unreadReady || userNavigated
    }
    private func updateVisibleMessages(_ ids: [String], listing: ConversationListing) {
        visibleIDs = listing.messages.map(\.id).filter { ids.contains($0) }
        guard canReportVisible else { return }
        features?.observeVisible(visibleIDs.first, atLatest: atLatest)
        reportVisibleMessages()
    }
    private func updateLatestPosition(_ latest: Bool) {
        atLatest = latest
        guard canReportVisible else { return }
        features?.observeVisible(visibleIDs.first, atLatest: latest)
    }
    private func reportVisibleMessages() {
        guard canReportVisible, let listing = model.listing else { return }
        let visible = Set(visibleIDs)
        for message in listing.messages where visible.contains(message.id) && message.author.actorID != model.scope.room.actorId {
            features?.displayed(message.id)
        }
    }
    private func resolveFirstUnread(_ proxy: ScrollViewProxy) {
        guard let features, features.readStateReady, let boundary = features.firstUnreadMessageId,
              !unreadReady, !userNavigated, quoteTarget == nil,
              let listing = model.listing, model.active else { return }
        if listing.messages.contains(where: { $0.id == boundary }) {
            if visibleIDs.contains(boundary) { unreadReady = true; reportVisibleMessages(); return }
            guard unreadScrollTarget != boundary else { return }
            unreadScrollTarget = boundary
            proxy.scrollTo(boundary, anchor: .top)
        } else if let cursor = listing.historyCursor, unreadExhaustedCursor != cursor {
            guard model.canLoadHistory, unreadFailedCursor != cursor, unreadAttemptedCursor != cursor else { return }
            unreadAttemptedCursor = cursor
            Task {
                let loaded = await model.history()
                if !loaded {
                    if model.error == nil { unreadAttemptedCursor = nil }
                    else { unreadFailedCursor = cursor }
                } else if model.listing?.historyCursor == cursor { unreadExhaustedCursor = cursor }
            }
        } else if let first = listing.messages.first {
            if visibleIDs.contains(first.id) { unreadReady = true; reportVisibleMessages(); return }
            guard unreadScrollTarget != first.id else { return }
            unreadScrollTarget = first.id
            proxy.scrollTo(first.id, anchor: .top)
        } else {
            unreadReady = true
        }
    }
    private func resolveQuote(_ proxy: ScrollViewProxy) {
        guard let target = quoteTarget, let listing = model.listing, model.active else { return }
        if listing.messages.contains(where: { $0.id == target }) {
            withAnimation { proxy.scrollTo(target, anchor: .center) }
            quoteTarget = nil; quoteNotice = nil
        } else if let cursor = listing.historyCursor {
            guard model.canLoadHistory, quoteAttemptedCursor != cursor else { return }
            quoteAttemptedCursor = cursor
            Task {
                let loaded = await model.history()
                guard quoteTarget == target else { return }
                if !loaded {
                    if model.error == nil { quoteAttemptedCursor = nil }
                    else { quoteTarget = nil; quoteNotice = "원본을 불러오지 못했어요. 다시 눌러 주세요." }
                } else if model.listing?.historyCursor == cursor {
                    quoteTarget = nil; quoteNotice = "원본을 불러오지 못했어요. 다시 눌러 주세요."
                }
            }
        } else {
            quoteTarget = nil; quoteNotice = "원본 메시지를 볼 수 없어요."
        }
    }
    private var composer: some View {
        VStack(alignment: .leading, spacing: 0) {
            if let features, features.viewport.incomingCount > 0 {
                Button { userNavigated = true; features.latest() } label: {
                    Label("새 메시지 \(features.viewport.incomingCount)개", systemImage: "arrow.down")
                        .font(.subheadline.weight(.semibold))
                        .padding(.horizontal, 14).padding(.vertical, 9)
                        .background(.regularMaterial, in: Capsule())
                }.frame(maxWidth: .infinity).padding(.bottom, 8)
            }
            if let quote = model.quote {
                HStack(alignment: .top) {
                    VStack(alignment: .leading, spacing: 3) {
                        Text("\(model.targetName)에게 비공개 답장").font(.caption).foregroundStyle(.secondary)
                        content(quote.content).lineLimit(2).font(.subheadline)
                    }
                    Spacer(minLength: 8)
                    Button { model.cancelReply() } label: { Image(systemName: "xmark.circle.fill") }.accessibilityLabel("답장 취소")
                }.padding(12)
                    .background(Color(uiColor: .secondarySystemGroupedBackground), in: RoundedRectangle(cornerRadius: 14))
                    .padding(.horizontal, 12).padding(.bottom, 8)
            }
            if let features, let (pending, receipt) = features.readyMedia {
                HStack(spacing: 10) {
                    AuthorizedMedia(client: features.media, assetID: receipt.assetId, access: .preview(pending.kind == .video ? .poster : .image))
                        .frame(width: 48, height: 48).clipShape(RoundedRectangle(cornerRadius: 10))
                    Button(pending.kind == .video ? "동영상" : "사진") { showMedia = true }
                        .font(.subheadline.weight(.medium))
                    Spacer(minLength: 8)
                    Button { features.discardMedia() } label: { Image(systemName: "xmark.circle.fill") }
                        .accessibilityLabel("첨부 취소")
                }
                .padding(8)
                .background(Color(uiColor: .secondarySystemGroupedBackground), in: RoundedRectangle(cornerRadius: 14))
                .padding(.horizontal, 12).padding(.bottom, 8)
            }
            if showStickers, let features {
                StickerPicker(client: features.media, sending: model.sending) { sticker in
                    features.latest()
                    _ = try await model.sendAttachment(OutgoingAttachment(type: "STICKER", stickerId: sticker.id))
                }
                .frame(height: 280)
                .transition(.move(edge: .bottom).combined(with: .opacity))
            }
            if showAttachments { attachmentTray.transition(.move(edge: .bottom).combined(with: .opacity)) }
            HStack(alignment: .bottom, spacing: 8) {
                if features != nil {
                    Button {
                        composing = false
                        showStickers = false
                        withAnimation(.easeInOut(duration: 0.2)) { showAttachments.toggle() }
                    } label: {
                        Image(systemName: showAttachments ? "xmark.circle.fill" : "plus.circle.fill")
                            .font(.system(size: 30, weight: .regular))
                            .frame(width: 42, height: 42)
                    }
                    .accessibilityLabel(showAttachments ? "첨부 메뉴 닫기" : "첨부 메뉴 열기")
                    .disabled(model.sending)
                }
                HStack(alignment: .bottom, spacing: 4) {
                    TextField(model.composerPrompt, text: $model.draft, axis: .vertical)
                        .lineLimit(1...6).textFieldStyle(.plain).focused($composing)
                        .padding(.leading, 15).padding(.vertical, 10)
                        .submitLabel(.send)
                        .onSubmit { sendComposer() }
                        .accessibilityLabel("메시지 내용")
                    if features != nil {
                        Button { toggleStickers() } label: {
                            Image(systemName: showStickers ? "keyboard" : "face.smiling")
                                .font(.system(size: 21))
                                .frame(width: 42, height: 42)
                        }.accessibilityLabel(showStickers ? "키보드 열기" : "스티커 선택")
                    }
                }
                .background(Color(uiColor: .secondarySystemBackground), in: RoundedRectangle(cornerRadius: 22, style: .continuous))
                Button { sendComposer() } label: {
                    Group {
                        if model.sending { ProgressView().tint(.white) }
                        else { Image(systemName: "arrow.up").font(.system(size: 18, weight: .bold)) }
                    }
                    .foregroundStyle(.white)
                    .frame(width: 42, height: 42)
                    .background(canSendComposer || model.sending ? AppTheme.accent : Color(uiColor: .systemGray3), in: Circle())
                }.disabled(!canSendComposer)
                    .accessibilityLabel(model.sendAccessibilityLabel)
            }.padding(.horizontal, 10).padding(.top, 9).padding(.bottom, 7)
        }
        .tint(AppTheme.accent)
        .background(Color(uiColor: .systemBackground))
        .overlay(alignment: .top) { Color(uiColor: .separator).opacity(0.35).frame(height: 0.5) }
    }
    private var canSendComposer: Bool {
        if let features, features.readyMedia != nil {
            return model.active && model.listing?.ready == true && !model.sending && !features.mediaBusy &&
                (model.draft.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty || (try? ConversationWire.normalizedText(model.draft)) != nil)
        }
        return model.canSend
    }
    private func sendComposer() {
        guard canSendComposer else { return }
        features?.latest()
        if let features, features.readyMedia != nil { Task { await features.sendReadyMedia() } }
        else { model.send() }
    }
    private func toggleStickers() {
        if showStickers {
            showStickers = false
            composing = true
        } else {
            composing = false
            showAttachments = false
            withAnimation(.easeInOut(duration: 0.2)) { showStickers = true }
        }
    }
    private var attachmentTray: some View {
        HStack(spacing: 0) {
            attachmentAction("카메라", icon: "camera.fill",
                             enabled: CameraCapture.isAvailable && features?.mediaBusy == false && features?.readyMedia == nil && !model.sending) {
                showCamera = true
            }
            if let features {
                MediaPicker(kind: .photo, enabled: !features.mediaBusy && !model.sending && features.readyMedia == nil, scope: features.mediaScope, compact: true) { file in
                    try await features.upload(file)
                    showAttachments = false
                    showMedia = true
                }
                MediaPicker(kind: .video, enabled: !features.mediaBusy && !model.sending && features.readyMedia == nil, scope: features.mediaScope, compact: true) { file in
                    try await features.upload(file)
                    showAttachments = false
                    showMedia = true
                }
            }
            attachmentAction("스티커", icon: "face.smiling") { toggleStickers() }
        }
        .padding(.horizontal, 12).padding(.top, 14).padding(.bottom, 8)
        .background(Color(uiColor: .systemBackground))
    }
    private func attachmentAction(_ title: String, icon: String, enabled: Bool = true, action: @escaping () -> Void) -> some View {
        Button {
            showAttachments = false
            action()
        } label: {
            VStack(spacing: 7) {
                Image(systemName: icon)
                    .font(.system(size: 23, weight: .medium))
                    .frame(width: 56, height: 56)
                    .background(AppTheme.accent.opacity(0.1), in: RoundedRectangle(cornerRadius: 18))
                Text(title).font(.caption.weight(.medium))
            }.frame(maxWidth: .infinity)
        }.disabled(!enabled).accessibilityLabel(title)
    }
    @ViewBuilder private func content(_ value: MessageContent) -> some View {
        switch value {
        case .text(let text): Text(text ?? "내용을 표시할 수 없는 메시지").textSelection(.enabled)
        case .photo(let items, _): Label("사진 \(items.count)장", systemImage: "photo")
        case .video: Label("동영상", systemImage: "video")
        case .sticker: Label("스티커", systemImage: "face.smiling")
        }
    }
    private func messageRow(_ message: ConversationMessage, beginsGroup: Bool, endsGroup: Bool,
                            onQuoteNavigate: @escaping (String) -> Void) -> some View {
        let mine = message.author.actorID == model.scope.room.actorId
        return HStack(alignment: .bottom, spacing: 8) {
            if mine { Spacer(minLength: 52) }
            if !mine {
                if endsGroup { avatar(for: message).frame(width: 30, height: 30) }
                else { Color.clear.frame(width: 30, height: 1) }
            }
            VStack(alignment: mine ? .trailing : .leading, spacing: 4) {
                if beginsGroup && !mine {
                    Text(message.author.displayName)
                        .font(.caption.weight(.medium)).foregroundStyle(.secondary)
                        .padding(.leading, 3)
                }
                HStack(alignment: .bottom, spacing: 5) {
                    if mine && endsGroup { Text(time(message.createdAt)).font(.caption2).foregroundStyle(.tertiary) }
                    VStack(alignment: mine ? .trailing : .leading, spacing: 4) {
                        VStack(alignment: .leading, spacing: 8) {
                            if let quote = message.quote {
                                Button { onQuoteNavigate(quote.id) } label: {
                                    VStack(alignment: .leading, spacing: 2) {
                                        Text(quote.authorName).font(.caption2.weight(.semibold))
                                        content(quote.content).font(.caption).lineLimit(2)
                                    }
                                    .foregroundStyle(mine ? Color.white.opacity(0.8) : Color.secondary)
                                    .padding(.leading, 10)
                                    .overlay(alignment: .leading) {
                                        Rectangle().fill(mine ? Color.white.opacity(0.55) : Color.secondary.opacity(0.4)).frame(width: 2)
                                    }
                                }.buttonStyle(.plain).accessibilityLabel("\(quote.authorName)의 원본 메시지로 이동")
                            }
                            messageContent(message).font(.body)
                        }
                        .foregroundStyle(mine ? Color.white : Color.primary)
                        .padding(.horizontal, 14).padding(.vertical, 10)
                        .background(mine ? AppTheme.accent : Color(uiColor: .secondarySystemBackground), in: RoundedRectangle(cornerRadius: 18, style: .continuous))
                        reactionPills(message)
                    }
                    if !mine && endsGroup { Text(time(message.createdAt)).font(.caption2).foregroundStyle(.tertiary) }
                }
            }
            if !mine { Spacer(minLength: 52) }
        }.contextMenu {
            if let features {
                ForEach(reactionChoices, id: \.self) { emoji in
                    Button(emoji) {
                        features.select(message)
                        if let token = features.token {
                            let mine = features.reactionsFor(message.id)?.mine == emoji
                            features.action(token, mine ? .removeReaction : .setReaction, emoji: mine ? nil : emoji)
                        }
                    }
                }
            }
            if let features { Button("메시지 작업", systemImage: "ellipsis.circle") { features.select(message); showActions = features.token != nil } }
            if !mine && model.scope.room.role == "STREAMER" && message.replyRecipient != nil {
                Button("비공개 답장", systemImage: "arrowshape.turn.up.left") { model.reply(to: message); composing = true }
            }
        }.accessibilityElement(children: .contain)
    }
    private func reactionPills(_ message: ConversationMessage) -> some View {
        let summary = features?.reactionsFor(message.id)
        let counts = summary?.counts ?? message.reactions.counts.map { ReactionCount(emoji: $0.emoji, count: $0.count) }
        let myEmoji = summary == nil ? message.reactions.mine : summary?.mine
        return VStack(alignment: .leading, spacing: 4) {
            ForEach(0..<((counts.count + 1 + 2) / 3), id: \.self) { row in
                HStack(spacing: 4) {
                    ForEach(row * 3..<min((row + 1) * 3, counts.count + 1), id: \.self) { index in
                        if index < counts.count {
                            let reaction = counts[index]
                            Button { features?.react(message, emoji: reaction.emoji) } label: {
                                Text("\(reaction.emoji) \(reaction.count)").font(.caption.weight(.medium))
                                    .padding(.horizontal, 9).padding(.vertical, 5)
                                    .background(myEmoji == reaction.emoji ? AppTheme.accent.opacity(0.16) : Color(uiColor: .tertiarySystemFill), in: Capsule())
                            }.buttonStyle(.plain).accessibilityLabel("\(reaction.emoji) 반응 \(reaction.count)개")
                        } else {
                            Button { features?.select(message); showActions = features?.token != nil } label: {
                                Image(systemName: "face.smiling").font(.caption)
                                    .overlay(alignment: .topTrailing) { Image(systemName: "plus").font(.system(size: 7, weight: .bold)).offset(x: 5, y: -3) }
                                    .padding(.horizontal, 9).padding(.vertical, 6)
                                    .background(Color(uiColor: .tertiarySystemFill), in: Capsule())
                            }.buttonStyle(.plain).accessibilityLabel("반응 추가")
                        }
                    }
                }
            }
        }
    }
    @ViewBuilder private func avatar(for message: ConversationMessage) -> some View {
        if let actor = message.author.actorID,
           let profile = model.listing?.profiles.first(where: { $0.actorId == actor }), let features {
            if let avatar = profile.avatar {
                AuthorizedMedia(client: features.media, assetID: avatar.assetId,
                    access: .avatar(room: model.scope.room.id, actor: actor), avatar: true)
                    .clipShape(Circle())
            } else if profile.providerAvatarAvailable {
                AuthorizedProviderAvatar(client: features.media, actorID: actor).clipShape(Circle())
            } else { fallbackAvatar() }
        } else { fallbackAvatar() }
    }
    private func fallbackAvatar() -> some View {
        Image(systemName: "person.fill")
            .font(.caption.weight(.semibold)).foregroundStyle(.secondary)
            .frame(maxWidth: .infinity, maxHeight: .infinity)
            .background(AppTheme.accent.opacity(0.12), in: Circle())
    }
    private func date(_ value: String) -> Date? {
        let format = ISO8601DateFormatter()
        format.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        if let parsed = format.date(from: value) { return parsed }
        format.formatOptions = [.withInternetDateTime]
        return format.date(from: value)
    }
    private func sameDay(_ first: ConversationMessage?, _ second: ConversationMessage) -> Bool {
        guard let first, let a = date(first.createdAt), let b = date(second.createdAt) else { return false }
        return Calendar.current.isDate(a, inSameDayAs: b)
    }
    private func sameGroup(_ first: ConversationMessage?, _ second: ConversationMessage?) -> Bool {
        guard let first, let second, first.author.actorID != nil,
              first.author.actorID == second.author.actorID,
              first.author.displayName == second.author.displayName,
              first.audience == second.audience, first.counterpart == second.counterpart,
              sameDay(first, second),
              let a = date(first.createdAt), let b = date(second.createdAt) else { return false }
        return b.timeIntervalSince(a) >= 0 && b.timeIntervalSince(a) < 300
    }
    private func day(_ value: String) -> String {
        guard let date = date(value) else { return "" }
        return date.formatted(.dateTime.year().month(.abbreviated).day().weekday(.wide))
    }
    @ViewBuilder private func messageContent(_ message: ConversationMessage) -> some View {
        if let features {
            switch message.content {
            case .text: content(message.content)
            case .photo(let items, let caption):
                ForEach(items, id: \.assetId) { item in
                    Button { openedMedia = OpenedConversationMedia(messageID: message.id, assetID: item.assetId, variant: .image) } label: {
                        AuthorizedMedia(client: features.media, assetID: item.assetId,
                            access: .message(room: model.scope.room.id, message: message.id, variant: .image))
                            .frame(maxWidth: 280, maxHeight: 360)
                    }.buttonStyle(.plain).accessibilityLabel("사진 크게 보기")
                }
                if let caption { Text(caption) }
            case .video(let items, let caption):
                ForEach(items, id: \.assetId) { item in
                    Button { openedMedia = OpenedConversationMedia(messageID: message.id, assetID: item.assetId, variant: .video) } label: {
                        AuthorizedMedia(client: features.media, assetID: item.assetId,
                            access: .message(room: model.scope.room.id, message: message.id, variant: .poster))
                            .frame(width: 260, height: 220)
                            .overlay { Image(systemName: "play.circle.fill").font(.system(size: 46)).foregroundStyle(.white).shadow(radius: 5) }
                    }.buttonStyle(.plain).accessibilityLabel("동영상 재생")
                }
                if let caption { Text(caption) }
            case .sticker(let id, let asset, _, _):
                AuthorizedMedia(client: features.media, assetID: asset, access: .sticker(room: model.scope.room.id, sticker: id, message: message.id)).frame(width: 150, height: 150)
            }
        } else { content(message.content) }
    }
    private var mediaSheet: some View {
        NavigationStack {
            if let features {
                ScrollView {
                    VStack(alignment: .leading, spacing: 18) {
                    if let error = features.error {
                        Text(error).font(.subheadline).foregroundStyle(.secondary)
                            .frame(maxWidth: .infinity, alignment: .leading)
                            .padding(14)
                            .background(Color(uiColor: .secondarySystemGroupedBackground), in: RoundedRectangle(cornerRadius: 14))
                    }
                    if let (pending, receipt) = features.readyMedia {
                        Text("\(model.scope.room.name) · 받는 사람: \(model.targetName)")
                            .font(.subheadline).foregroundStyle(.secondary)
                        AuthorizedMedia(client: features.media, assetID: receipt.assetId, access: .preview(pending.kind == .video ? .video : .image))
                            .frame(maxWidth: .infinity).frame(height: 280).clipShape(RoundedRectangle(cornerRadius: 18))
                        Button("작성창으로 돌아가기") { showMedia = false }
                            .disabled(features.mediaBusy)
                            .buttonStyle(.borderedProminent).frame(maxWidth: .infinity)
                        Button("선택 취소", role: .cancel) { features.discardMedia() }.disabled(model.sending)
                            .frame(maxWidth: .infinity)
                    } else {
                        if features.mediaBusy { ProgressView("첨부 준비 중").frame(maxWidth: .infinity) }
                        HStack(alignment: .top, spacing: 8) {
                            MediaPicker(kind: .photo, enabled: !features.mediaBusy, scope: features.mediaScope, compact: true) { try await features.upload($0) }
                            MediaPicker(kind: .video, enabled: !features.mediaBusy, scope: features.mediaScope, compact: true) { try await features.upload($0) }
                        }
                        if !features.pendingMedia.isEmpty {
                            VStack(alignment: .leading, spacing: 12) {
                                Text("이전에 선택한 항목").font(.headline)
                                ForEach(features.pendingMedia, id: \.assetId) { pending in
                                    Button(pending.kind == .video ? "동영상 계속 첨부" : "사진 계속 첨부") { Task { await features.recover(pending) } }.disabled(features.mediaBusy)
                                }
                            }
                        }
                    }
                    }.padding(16)
                }
                .background(Color(uiColor: .systemGroupedBackground))
                .tint(AppTheme.accent)
                .navigationTitle("사진·동영상").navigationBarTitleDisplayMode(.inline)
                    .toolbar { ToolbarItem(placement: .cancellationAction) { Button("닫기") { showMedia = false } } }
            }
        }
    }
    private func commandRow(_ command: StoredTextCommand) -> some View {
        VStack(alignment: .trailing, spacing: 6) {
            // A committed receipt without an authorized projection never displays retained body.
            if [.queued, .sending, .unknown, .rejected].contains(command.phase), let text = command.command?.text {
                Text(text).padding(12).background(Color(uiColor: .secondarySystemBackground), in: RoundedRectangle(cornerRadius: 16))
            }
            if !command.notice.isEmpty { Text(command.notice).font(.caption).foregroundStyle(.secondary) }
        }.frame(maxWidth: .infinity, alignment: .trailing).padding(.leading, 36)
    }
    private func time(_ value: String) -> String {
        date(value)?.formatted(date: .omitted, time: .shortened) ?? ""
    }
}

private struct OpenedConversationMedia: Identifiable {
    let messageID: String
    let assetID: String
    let variant: MediaVariant
    var id: String { messageID + ":" + assetID }
}

private struct ConversationActionsSheet: View {
    let features: ConversationFeatureModel
    let token: ActionViewToken
    let onClose: () -> Void
    private var unavailable: Set<MessageAction> {
        (try? features.actions.blockedActions(token)) ?? [.delete, .publish, .report, .blockActor, .setReaction, .removeReaction]
    }
    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(alignment: .leading, spacing: 24) {
                    if let error = features.error { Text(error).font(.footnote).foregroundStyle(.secondary) }
                    MessageActionsPanel(token: token, record: features.record, busy: features.busy, reactions: features.reactions, unavailableActions: unavailable,
                        onAction: { features.action($0, $1, emoji: $2) }, onRefresh: { token in Task { await features.refreshAction(token) } })
                    Divider()
                    MessageModerationPanel(unavailableActions: unavailable, token: token, busy: features.busy,
                        preview: features.conversation.listing?.messages.first(where: { $0.id == token.selection.messageId }).map { message in
                            switch message.content {
                            case .text(let value): value ?? "내용을 볼 수 없는 메시지"
                            case .photo: "사진"
                            case .video: "동영상"
                            case .sticker: "스티커"
                            }
                        } ?? "메시지를 다시 확인해 주세요",
                        onAction: { features.action($0, $1, reason: $2) })
                }.padding()
            }.navigationTitle("메시지").navigationBarTitleDisplayMode(.inline)
                .toolbar { ToolbarItem(placement: .cancellationAction) { Button("닫기", action: onClose) } }
        }
    }
}
