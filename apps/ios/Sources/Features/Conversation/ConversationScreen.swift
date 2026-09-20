import SwiftUI
import RogichatRooms

struct ConversationScreen: View {
    @State private var model: ConversationScreenModel
    @State private var features: ConversationFeatureModel?
    @State private var showMedia = false
    @State private var showStickers = false
    @State private var showActions = false
    @State private var visibleIDs: [String] = []
    @State private var atLatest = true
    @State private var visible = false
    @State private var selectingRecipient = false
    @FocusState private var composing: Bool
    @Environment(\.scenePhase) private var scenePhase
    let onReopen: () -> Void
    init(model: ConversationScreenModel, session: AppSession, environment: String, accountID: String, onReopen: @escaping () -> Void) {
        _model = State(initialValue: model)
        _features = State(initialValue: try? ConversationFeatureModel(conversation: model, session: session, environment: environment, accountID: accountID))
        self.onReopen = onReopen
    }
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
            if let listing = model.listing, model.active {
                ScrollViewReader { proxy in
                    ScrollView {
                        LazyVStack(spacing: 20) {
                            if listing.historyCursor != nil {
                                if model.loadingHistory { ProgressView("이전 메시지를 불러오는 중") }
                                else { Button("이전 메시지 보기") { Task { await model.history() } }.disabled(model.loading || model.checking || model.sending) }
                            }
                            if listing.ready && listing.messages.isEmpty && listing.commands.isEmpty {
                                ContentUnavailableView("아직 메시지가 없어요", systemImage: "bubble.left.and.bubble.right", description: Text("이 대화에서 볼 수 있는 메시지가 여기에 표시돼요."))
                                    .padding(.top, 24)
                            }
                            ForEach(listing.messages) { message in
                                messageRow(message).id(message.id)
                                    .onScrollVisibilityChange(threshold: 0.6) { isVisible in if isVisible { features?.displayed(message.id) } }
                            }
                            let visibleIDs = Set(listing.messages.map(\.id))
                            ForEach(listing.commands.filter { $0.phase != .committed || !visibleIDs.contains($0.messageID ?? "") }) { command in
                                commandRow(command).id(command.id)
                            }
                            Color.clear.frame(height: 1).id("conversation-bottom")
                        }.scrollTargetLayout().padding(.horizontal, 16).padding(.vertical, 16)
                    }
                    .scrollDismissesKeyboard(.interactively)
                    .onScrollTargetVisibilityChange(idType: String.self, threshold: 0.6) { ids in
                        visibleIDs = listing.messages.map(\.id).filter { ids.contains($0) }
                        features?.observeVisible(visibleIDs.first, atLatest: atLatest)
                    }
                    .onScrollGeometryChange(for: Bool.self) { geometry in
                        geometry.contentOffset.y + geometry.containerSize.height >= geometry.contentSize.height - 48
                    } action: { _, value in
                        atLatest = value; features?.observeVisible(visibleIDs.first, atLatest: value)
                    }
                    .onChange(of: features?.move) { _, move in
                        switch move {
                        case .latest: withAnimation { proxy.scrollTo("conversation-bottom", anchor: .bottom) }
                        case .restore(let anchor): proxy.scrollTo(anchor.messageId, anchor: .top)
                        default: break
                        }
                        features?.consumedMove()
                    }

                }
            } else if model.loading || model.error == nil {
                ScreenStatus(title: "대화를 불러오는 중", message: "", loading: true).frame(maxHeight: .infinity)
            } else { Spacer() }
        }
        .background(Color(uiColor: .systemBackground))
        .navigationTitle(model.scope.room.name)
        .navigationBarTitleDisplayMode(.inline)
        .toolbar { ToolbarItem(placement: .topBarTrailing) {
            Button { Task { await model.refresh() } } label: { Image(systemName: "arrow.clockwise") }
                .accessibilityLabel("대화 새로고침").disabled(!model.active || model.loading || model.sending || model.checking)
        } }
        .safeAreaInset(edge: .bottom, spacing: 0) { if model.active, model.listing?.ready == true { composer } }
        .task {
            await model.load()
            if let listing = model.listing { features?.projectionChanged(listing, history: false) }
            await features?.load()
        }
        .onChange(of: model.listing?.messages) { _, _ in
            if let listing = model.listing { features?.projectionChanged(listing, history: model.loadingHistory) }
        }
        .onChange(of: model.active) { _, active in if !active { features?.close(); showActions = false; showMedia = false; showStickers = false } }
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
        .onChange(of: scenePhase) { _, phase in if phase == .active, visible { Task { await model.refresh() } } }
        .sheet(isPresented: $selectingRecipient) { recipientPicker }
        .sheet(isPresented: $showMedia) { mediaSheet }
        .sheet(isPresented: $showStickers) {
            if let features { NavigationStack {
                StickerPicker(client: features.media) { content in
                    if case .sticker(let id) = content { _ = try await model.sendAttachment(OutgoingAttachment(type: "STICKER", stickerId: id)); showStickers = false }
                }.navigationTitle("스티커").toolbar { ToolbarItem(placement: .cancellationAction) { Button("닫기") { showStickers = false } } }
            } }
        }
        .sheet(isPresented: $showActions, onDismiss: { features?.dismissActions() }) {
            if let features, let token = features.token { ConversationActionsSheet(features: features, token: token, onClose: { showActions = false }) }
        }
    }
    private var composer: some View {
        VStack(alignment: .leading, spacing: 10) {
            Divider()
            if let features, features.viewport.incomingCount > 0 {
                Button("새 메시지 \(features.viewport.incomingCount)개") { features.latest() }.frame(maxWidth: .infinity)
            }
            if let quote = model.quote {
                HStack(alignment: .top) {
                    VStack(alignment: .leading, spacing: 3) {
                        Text("\(model.targetName)에게 비공개 답장").font(.caption).foregroundStyle(.secondary)
                        content(quote.content).lineLimit(2).font(.subheadline)
                    }
                    Spacer(minLength: 8)
                    Button { model.cancelReply() } label: { Image(systemName: "xmark.circle.fill") }.accessibilityLabel("답장 취소")
                }.padding(.horizontal)
            } else if model.scope.room.mode == "FAN" {
                Button { selectingRecipient = true } label: {
                    Label(model.targetName, systemImage: model.privateTarget == nil && model.sharedAllowed ? "person.2" : "lock")
                        .font(.subheadline.weight(.medium))
                }.padding(.horizontal).disabled(model.sending)
            }
            HStack(alignment: .bottom, spacing: 10) {
                if features != nil {
                    Menu { Button("사진·동영상", systemImage: "photo") { showMedia = true }; Button("스티커", systemImage: "face.smiling") { showStickers = true } }
                    label: { Image(systemName: "plus.circle").font(.title2).frame(width: 32, height: 42) }
                        .accessibilityLabel("첨부").disabled(model.sending)
                }
                TextField("메시지", text: $model.draft, axis: .vertical)
                    .lineLimit(1...6).textFieldStyle(.plain).focused($composing)
                    .padding(.horizontal, 14).padding(.vertical, 11)
                    .background(Color(uiColor: .secondarySystemBackground), in: RoundedRectangle(cornerRadius: 20))
                    .accessibilityLabel("메시지 내용")
                Button { model.send() } label: {
                    if model.sending { ProgressView().frame(width: 42, height: 42) }
                    else { Image(systemName: "arrow.up").font(.headline).frame(width: 42, height: 42) }
                }.buttonStyle(.borderedProminent).buttonBorderShape(.circle).disabled(!model.canSend)
                    .accessibilityLabel("메시지 보내기")
            }.padding(.horizontal).padding(.bottom, 10)
        }.background(.bar)
    }
    @ViewBuilder private func content(_ value: MessageContent) -> some View {
        switch value {
        case .text(let text): Text(text ?? "내용을 표시할 수 없는 메시지").textSelection(.enabled)
        case .photo(let items): Label("사진 \(items.count)장", systemImage: "photo")
        case .video: Label("동영상", systemImage: "video")
        case .sticker: Label("스티커", systemImage: "face.smiling")
        }
    }
    private func messageRow(_ message: ConversationMessage) -> some View {
        let mine = message.author.actorID == model.scope.room.actorId
        return HStack(alignment: .bottom, spacing: 8) {
            if mine { Spacer(minLength: 36) }
            VStack(alignment: mine ? .trailing : .leading, spacing: 6) {
                HStack(spacing: 6) {
                    Text(message.author.displayName).font(.caption.weight(.medium))
                    if message.audience == "PRIVATE" { Label("비공개", systemImage: "lock.fill").font(.caption2) }
                }.foregroundStyle(.secondary)
                VStack(alignment: .leading, spacing: 9) {
                    if let quote = message.quote { content(quote.content).font(.caption).foregroundStyle(.secondary).padding(.leading, 10).overlay(alignment: .leading) { Rectangle().fill(.secondary.opacity(0.4)).frame(width: 2) } }
                    messageContent(message).font(.body)
                }.padding(.horizontal, 14).padding(.vertical, 11)
                    .background(mine ? AppTheme.accent.opacity(0.14) : Color(uiColor: .secondarySystemBackground), in: RoundedRectangle(cornerRadius: 18))
                Text(time(message.createdAt)).font(.caption2).foregroundStyle(.secondary)
            }
            if !mine { Spacer(minLength: 36) }
        }.contextMenu {
            if let features { Button("메시지 작업", systemImage: "ellipsis.circle") { features.select(message); showActions = features.token != nil } }
            if message.replyRecipient != nil { Button("비공개 답장", systemImage: "arrowshape.turn.up.left") { model.reply(to: message); composing = true } }
        }.accessibilityElement(children: .contain)
    }
    @ViewBuilder private func messageContent(_ message: ConversationMessage) -> some View {
        if let features {
            switch message.content {
            case .text: content(message.content)
            case .photo(let items):
                ForEach(items, id: \.assetId) { item in AuthorizedMedia(client: features.media, assetID: item.assetId,
                    access: .message(room: model.scope.room.id, message: message.id, variant: .image)).frame(maxWidth: 280, maxHeight: 360) }
            case .video(let items):
                ForEach(items, id: \.assetId) { item in AuthorizedMedia(client: features.media, assetID: item.assetId,
                    access: .message(room: model.scope.room.id, message: message.id, variant: .video)).frame(width: 260, height: 220) }
            case .sticker(let id, let asset, _, _):
                AuthorizedMedia(client: features.media, assetID: asset, access: .sticker(room: model.scope.room.id, sticker: id, message: message.id)).frame(width: 150, height: 150)
            }
        } else { content(message.content) }
    }
    private var mediaSheet: some View {
        NavigationStack {
            if let features {
                List {
                    if let error = features.error { Text(error).foregroundStyle(.secondary) }
                    if let (pending, receipt) = features.readyMedia {
                        AuthorizedMedia(client: features.media, assetID: receipt.assetId, access: .preview(pending.kind == .video ? .video : .image)).frame(height: 240)
                        Button("메시지로 보내기") { Task { await features.sendReadyMedia(); if features.readyMedia == nil { showMedia = false } } }
                            .disabled(model.sending || features.mediaBusy)
                        Button("선택 닫기", role: .cancel) { features.discardMedia() }.disabled(model.sending)
                    } else {
                        MediaPicker(kind: .photo, enabled: !features.mediaBusy, scope: features.mediaScope) { try await features.upload($0) }
                        MediaPicker(kind: .video, enabled: !features.mediaBusy, scope: features.mediaScope) { try await features.upload($0) }
                        if !features.pendingMedia.isEmpty {
                            Section("이전에 업로드한 항목") {
                                ForEach(features.pendingMedia, id: \.assetId) { pending in
                                    Button(pending.kind == .video ? "동영상 상태 확인" : "사진 상태 확인") { Task { await features.recover(pending) } }.disabled(features.mediaBusy)
                                }
                            }
                        }
                    }
                }.navigationTitle("사진·동영상").navigationBarTitleDisplayMode(.inline)
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
            Text(command.notice).font(.caption).foregroundStyle(.secondary)
            if command.phase == .unknown || command.phase == .sending {
                Button("저장 여부 확인") { Task { await model.checkCommands() } }.font(.caption).disabled(model.sending || model.checking || model.loading)
            }
        }.frame(maxWidth: .infinity, alignment: .trailing).padding(.leading, 36)
    }
    private func time(_ value: String) -> String {
        let f = ISO8601DateFormatter(); f.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        return f.date(from: value)?.formatted(date: .abbreviated, time: .shortened) ?? ""
    }
    private var recipientPicker: some View {
        NavigationStack {
            List {
                if model.sharedAllowed { Button("전체 대화") { model.choose(nil); selectingRecipient = false } }
                Section("비공개 메시지") {
                    ForEach(model.recipients) { candidate in
                        Button(candidate.nickname) { model.choose(candidate); selectingRecipient = false }
                    }
                    if model.recipientsLoading { ProgressView("받는 사람을 확인하는 중") }
                    else if let error = model.recipientsError {
                        Text(error).foregroundStyle(.secondary)
                        Button("다시 확인") { Task { await model.loadRecipients() } }
                    } else if model.recipients.isEmpty { Text("현재 비공개 메시지를 보낼 수 있는 사람이 없어요.").foregroundStyle(.secondary) }
                    if model.recipientsNext != nil { Button("더 보기") { Task { await model.loadRecipients(more: true) } }.disabled(model.recipientsLoading) }
                }
            }.navigationTitle("받는 사람").navigationBarTitleDisplayMode(.inline)
                .toolbar { ToolbarItem(placement: .cancellationAction) { Button("닫기") { selectingRecipient = false } } }
                .task { await model.loadRecipients() }
        }
    }
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
                        onAction: { features.action($0, $1, reason: $2) })
                }.padding()
            }.navigationTitle("메시지").navigationBarTitleDisplayMode(.inline)
                .toolbar { ToolbarItem(placement: .cancellationAction) { Button("닫기", action: onClose) } }
        }
    }
}
