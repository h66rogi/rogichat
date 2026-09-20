import SwiftUI
import RogichatRooms

struct ConversationScreen: View {
    @State private var model: ConversationScreenModel
    @State private var visible = false
    @State private var selectingRecipient = false
    @FocusState private var composing: Bool
    @Environment(\.scenePhase) private var scenePhase
    let onReopen: () -> Void
    init(model: ConversationScreenModel, onReopen: @escaping () -> Void) { _model = State(initialValue: model); self.onReopen = onReopen }
    var body: some View {
        VStack(spacing: 0) {
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
                            }
                            let visibleIDs = Set(listing.messages.map(\.id))
                            ForEach(listing.commands.filter { $0.phase != .committed || !visibleIDs.contains($0.messageID ?? "") }) { command in
                                commandRow(command).id(command.id)
                            }
                            Color.clear.frame(height: 1).id("conversation-bottom")
                        }.padding(.horizontal, 16).padding(.vertical, 16)
                    }
                    .scrollDismissesKeyboard(.interactively)
                    .onAppear { proxy.scrollTo("conversation-bottom", anchor: .bottom) }
                    .onChange(of: listing.messages.last?.id) { _, _ in
                        if !model.loadingHistory { withAnimation { proxy.scrollTo("conversation-bottom", anchor: .bottom) } }
                    }
                    .onChange(of: model.sending) { _, value in if value { withAnimation { proxy.scrollTo("conversation-bottom", anchor: .bottom) } } }
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
        .task { await model.load() }
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
    }
    private var composer: some View {
        VStack(alignment: .leading, spacing: 10) {
            Divider()
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
                    content(message.content).font(.body)
                }.padding(.horizontal, 14).padding(.vertical, 11)
                    .background(mine ? AppTheme.accent.opacity(0.14) : Color(uiColor: .secondarySystemBackground), in: RoundedRectangle(cornerRadius: 18))
                Text(time(message.createdAt)).font(.caption2).foregroundStyle(.secondary)
            }
            if !mine { Spacer(minLength: 36) }
        }.contextMenu {
            if message.replyRecipient != nil { Button("비공개 답장", systemImage: "arrowshape.turn.up.left") { model.reply(to: message); composing = true } }
        }.accessibilityElement(children: .contain)
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
