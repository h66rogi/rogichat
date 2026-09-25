import SwiftUI
import RogichatRooms

struct ConversationScreen: View {
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
    @State private var playingVideo: ConversationMessage?
    @State private var visibleIDs: [String] = []
    @State private var atLatest = true
    @State private var visible = false
    @FocusState private var composing: Bool
    @Environment(\.scenePhase) private var scenePhase
    let onReopen: () -> Void
    let onLeave: () async -> String?
    init(model: ConversationScreenModel, session: AppSession, environment: String, accountID: String,
         onReopen: @escaping () -> Void, onLeave: @escaping () async -> String?) {
        _model = State(initialValue: model)
        _features = State(initialValue: try? ConversationFeatureModel(conversation: model, session: session, environment: environment, accountID: accountID))
        self.onReopen = onReopen
        self.onLeave = onLeave
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
                        LazyVStack(spacing: 4) {
                            if listing.historyCursor != nil {
                                if model.loadingHistory { ProgressView("이전 메시지를 불러오는 중") }
                                else { Button("이전 메시지 보기") { Task { await model.history() } }.disabled(model.loading || model.checking || model.sending) }
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
                                messageRow(message, beginsGroup: !sameGroup(previous, message), endsGroup: !sameGroup(message, next))
                                    .padding(.top, sameGroup(previous, message) ? 0 : 12)
                                    .id(message.id)
                                    .onScrollVisibilityChange(threshold: 0.6) { isVisible in if isVisible {
                                        features?.displayed(message.id)
                                        if let features { Task { await features.loadReaction(message) } }
                                    } }
                            }
                            ForEach(listing.commands.filter { [.queued, .sending, .unknown, .rejected, .blocked].contains($0.phase) }) { command in
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
                    .onScrollGeometryChange(for: CGSize.self) { $0.containerSize } action: { _, _ in
                        if composing || showStickers { scrollToLatest(proxy) }
                    }
                    .onChange(of: composing) { _, focused in
                        if focused { scrollToLatest(proxy) }
                    }
                    .onChange(of: model.draft) { _, _ in
                        if composing { scrollToLatest(proxy) }
                    }
                    .onChange(of: showStickers) { _, open in
                        if open { scrollToLatest(proxy) }
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
        .toolbar(.visible, for: .navigationBar)
        .toolbar(.hidden, for: .tabBar)
        .toolbar { ToolbarItem(placement: .topBarTrailing) {
            Menu {
                Button("새로고침", systemImage: "arrow.clockwise") { Task { await model.refresh() } }
                Button(role: .destructive) {
                    confirmLeave = true
                } label: { Label("대화에서 나가기", systemImage: "rectangle.portrait.and.arrow.right") }
            } label: { Image(systemName: "line.3.horizontal") }
                .accessibilityLabel("대화 메뉴")
                .disabled(!model.active || model.loading || model.sending || model.checking)
        } }
        .confirmationDialog("대화에서 나갈까요?", isPresented: $confirmLeave, titleVisibility: .visible) {
            Button("나가기", role: .destructive) {
                Task {
                    if let error = await onLeave() { leaveError = error }
                }
            }
            Button("취소", role: .cancel) {}
        } message: {
            Text("나가도 보낸 메시지는 삭제되지 않아요.")
        }
        .alert("대화에서 나가지 못했어요", isPresented: Binding(get: { leaveError != nil }, set: { if !$0 { leaveError = nil } })) {
            Button("확인") { leaveError = nil }
        } message: { Text(leaveError ?? "") }
        .safeAreaInset(edge: .bottom, spacing: 0) { if model.active, model.listing?.ready == true { composer } }
        .task {
            await model.load()
            if let listing = model.listing { features?.projectionChanged(listing, history: false) }
            await features?.load()
        }
        .onChange(of: model.listing?.messages) { _, _ in
            if let listing = model.listing { features?.projectionChanged(listing, history: model.loadingHistory) }
        }
        .onChange(of: model.active) { _, active in if !active { features?.close(); showActions = false; showMedia = false; showCamera = false; showStickers = false; showAttachments = false; playingVideo = nil } }
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
        .sheet(item: $playingVideo) { message in
            if let features, case .video(let items, _) = message.content, let item = items.first {
                NavigationStack {
                    AuthorizedMedia(client: features.media, assetID: item.assetId,
                        access: .message(room: model.scope.room.id, message: message.id, variant: .video))
                        .frame(maxWidth: .infinity, maxHeight: .infinity)
                        .background(Color.black)
                        .navigationTitle("동영상").navigationBarTitleDisplayMode(.inline)
                        .toolbar { ToolbarItem(placement: .cancellationAction) { Button("닫기") { playingVideo = nil } } }
                }
            }
        }
    }
    private func scrollToLatest(_ proxy: ScrollViewProxy) {
        Task { @MainActor in
            await Task.yield()
            proxy.scrollTo("conversation-bottom", anchor: .bottom)
        }
    }
    private var composer: some View {
        VStack(alignment: .leading, spacing: 0) {
            if let features, features.viewport.incomingCount > 0 {
                Button { features.latest() } label: {
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
                    TextField("메시지 입력", text: $model.draft, axis: .vertical)
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
                    .accessibilityLabel("메시지 보내기")
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
    private func messageRow(_ message: ConversationMessage, beginsGroup: Bool, endsGroup: Bool) -> some View {
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
                if beginsGroup && message.audience == "PRIVATE" {
                    Label("비공개", systemImage: "lock.fill")
                        .font(.caption2.weight(.medium)).foregroundStyle(.secondary)
                }
                HStack(alignment: .bottom, spacing: 5) {
                    if mine && endsGroup { Text(time(message.createdAt)).font(.caption2).foregroundStyle(.tertiary) }
                    VStack(alignment: .leading, spacing: 8) {
                        if let quote = message.quote {
                            content(quote.content)
                                .font(.caption).lineLimit(2)
                                .foregroundStyle(mine ? Color.white.opacity(0.8) : Color.secondary)
                                .padding(.leading, 10)
                                .overlay(alignment: .leading) { Rectangle().fill(mine ? Color.white.opacity(0.55) : Color.secondary.opacity(0.4)).frame(width: 2) }
                        }
                        messageContent(message).font(.body)
                    }
                    .foregroundStyle(mine ? Color.white : Color.primary)
                    .padding(.horizontal, 14).padding(.vertical, 10)
                    .background(mine ? AppTheme.accent : Color(uiColor: .secondarySystemBackground), in: RoundedRectangle(cornerRadius: 18, style: .continuous))
                    if !mine && endsGroup { Text(time(message.createdAt)).font(.caption2).foregroundStyle(.tertiary) }
                }
                if let summary = features?.reactionsFor(message.id) {
                    HStack(spacing: 5) {
                        ForEach(summary.counts.filter { $0.count > 0 }, id: \.emoji) { count in
                            Button("\(count.emoji) \(count.count)") {
                                features?.select(message); showActions = features?.token != nil
                            }.font(.caption).buttonStyle(.bordered)
                        }
                    }
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
            if !mine && model.scope.room.role == "STREAMER" && message.replyRecipient != nil { Button("비공개 답장", systemImage: "arrowshape.turn.up.left") { model.reply(to: message); composing = true } }
        }.accessibilityElement(children: .contain)
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
              first.audience == second.audience, sameDay(first, second),
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
                ForEach(items, id: \.assetId) { item in AuthorizedMedia(client: features.media, assetID: item.assetId,
                    access: .message(room: model.scope.room.id, message: message.id, variant: .image)).frame(maxWidth: 280, maxHeight: 360) }
                if let caption { Text(caption) }
            case .video(let items, let caption):
                ForEach(items, id: \.assetId) { item in
                    Button { playingVideo = message } label: {
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
