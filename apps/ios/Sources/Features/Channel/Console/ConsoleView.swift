import SwiftUI
import Kingfisher

struct ConsoleView: View {
    @StateObject private var viewModel: ConsoleViewModel
    @Environment(\.dismiss) private var dismiss
    @State private var showEndSessionAlert = false
    @State private var showClearQueueAlert = false

    init(channelId: Int, channelIdentifier: String) {
        _viewModel = StateObject(wrappedValue: ConsoleViewModel(channelId: channelId, channelIdentifier: channelIdentifier))
    }

    var body: some View {
        Group {
            if viewModel.sessionLoading {
                LoadingView()
            } else if viewModel.isSessionActive {
                activeSessionContent
            } else {
                inactiveSessionContent
            }
        }
        .navigationTitle("신청곡 콘솔")
        .navigationBarTitleDisplayMode(.inline)
        .navigationBarBackButtonHidden(true)
        .toolbar {
            ToolbarItem(placement: .navigationBarLeading) {
                Button {
                    dismiss()
                } label: {
                    Image(systemName: "chevron.left")
                }
            }

            if viewModel.isSessionActive {
                ToolbarItem(placement: .principal) {
                    sessionStatusBadge
                }

                ToolbarItem(placement: .navigationBarTrailing) {
                    Button("세션 종료") {
                        showEndSessionAlert = true
                    }
                    .foregroundColor(.red)
                    .font(.subheadline)
                }
            }
        }
        .alert("세션 종료", isPresented: $showEndSessionAlert) {
            Button("종료", role: .destructive) {
                Task { await viewModel.endSession() }
            }
            Button("취소", role: .cancel) {}
        } message: {
            Text("현재 세션을 종료하시겠습니까?\n대기열의 모든 신청곡이 초기화됩니다.")
        }
        .alert("대기열 초기화", isPresented: $showClearQueueAlert) {
            Button("초기화", role: .destructive) {
                Task { await viewModel.clearQueue() }
            }
            Button("취소", role: .cancel) {}
        } message: {
            Text("대기열의 모든 신청곡을 삭제하시겠습니까?")
        }
        .alert("오류", isPresented: Binding(
            get: { viewModel.error != nil },
            set: { if !$0 { viewModel.error = nil } }
        )) {
            Button("확인", role: .cancel) {}
        } message: {
            if let error = viewModel.error {
                Text(error)
            }
        }
        .sheet(isPresented: $viewModel.showManualAddSheet) {
            ManualAddSheet(viewModel: viewModel)
        }
        .task {
            await viewModel.loadInitialData()
        }
        .onDisappear {
            viewModel.onDisappear()
        }
    }

    // MARK: - Active Session Content

    private var activeSessionContent: some View {
        VStack(spacing: 0) {
            if let nowPlaying = viewModel.nowPlaying {
                NowPlayingCard(
                    request: nowPlaying,
                    onPlayNext: { Task { await viewModel.playNext() } },
                    onSkip: { Task { await viewModel.skipCurrent() } }
                )
                .padding(.horizontal)
                .padding(.top, 8)
            }

            ConsoleTabBar(selectedTab: $viewModel.activeTab)

            TabView(selection: $viewModel.activeTab) {
                QueueTabView(
                    queue: viewModel.queue,
                    onPlayNow: { id in Task { await viewModel.playNow(requestId: id) } },
                    onDelete: { id in Task { await viewModel.deleteRequest(requestId: id) } },
                    onMoveUp: { id in moveItem(id: id, direction: -1) },
                    onMoveDown: { id in moveItem(id: id, direction: 1) },
                    onClearAll: { showClearQueueAlert = true }
                )
                .tag(ConsoleTab.queue)

                HistoryTabView(history: viewModel.history)
                    .task { await viewModel.loadHistory() }
                    .tag(ConsoleTab.history)

                SettingsTabView(viewModel: viewModel)
                    .tag(ConsoleTab.settings)
            }
            .tabViewStyle(.page(indexDisplayMode: .never))
        }
        .overlay(alignment: .bottomTrailing) {
            if viewModel.activeTab == .queue {
                Button {
                    viewModel.showManualAddSheet = true
                } label: {
                    Image(systemName: "plus")
                        .font(.title2)
                        .fontWeight(.semibold)
                        .foregroundColor(.white)
                        .frame(width: 56, height: 56)
                        .background(Color.accentColor)
                        .clipShape(Circle())
                        .shadow(radius: 4, y: 2)
                }
                .padding(.trailing, 20)
                .padding(.bottom, 20)
            }
        }
    }

    // MARK: - Session Status Badge

    private var sessionStatusBadge: some View {
        HStack(spacing: 6) {
            Circle()
                .fill(Color.green)
                .frame(width: 8, height: 8)
            Text("신청곡 콘솔")
                .font(.headline)
                .foregroundColor(.primary)
        }
    }

    // MARK: - Inactive Session

    private var inactiveSessionContent: some View {
        ScrollView {
            VStack(spacing: 24) {
                Spacer().frame(height: 40)

                Image(systemName: "music.mic")
                    .font(.system(size: 64))
                    .foregroundColor(.secondary)

                Text("세션이 활성화되어 있지 않습니다")
                    .font(.headline)
                    .foregroundColor(.secondary)

                Text("세션을 시작하면 시청자들의\n신청곡을 받을 수 있습니다")
                    .font(.subheadline)
                    .foregroundColor(.secondary)
                    .multilineTextAlignment(.center)

                Button {
                    Task { await viewModel.startSession() }
                } label: {
                    HStack {
                        Image(systemName: "play.fill")
                        Text("새 세션 시작")
                    }
                    .font(.headline)
                    .foregroundColor(.white)
                    .padding(.horizontal, 32)
                    .padding(.vertical, 14)
                    .background(Color.accentColor)
                    .cornerRadius(12)
                }
                .disabled(viewModel.isLoading)

                if viewModel.isLoading {
                    ProgressView()
                }

                if !viewModel.sessionHistory.isEmpty {
                    Divider()
                        .padding(.horizontal, 32)
                        .padding(.top, 8)

                    Text("이전 세션")
                        .font(.headline)
                        .frame(maxWidth: .infinity, alignment: .leading)
                        .padding(.horizontal)

                    ForEach(viewModel.sessionHistory) { session in
                        SessionHistoryCard(session: session) {
                            Task { await viewModel.cloneSession(sourceSessionId: session.id) }
                        }
                        .padding(.horizontal)
                    }
                }

                Spacer().frame(height: 32)
            }
        }
    }

    // MARK: - Helpers

    private func moveItem(id: Int, direction: Int) {
        guard let index = viewModel.queue.firstIndex(where: { $0.id == id }) else { return }
        let newIndex = index + direction
        guard newIndex >= 0 && newIndex < viewModel.queue.count else { return }
        let newOrder = viewModel.queue[newIndex].queueOrder
        Task { await viewModel.reorderRequest(requestId: id, newOrder: newOrder) }
    }
}

// MARK: - Session History Card

private struct SessionHistoryCard: View {
    let session: SessionHistoryItem
    let onClone: () -> Void

    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            HStack {
                Text(formatDate(session.startedAt))
                    .font(.subheadline.bold())
                Spacer()
                Text(session.platform)
                    .font(.caption)
                    .foregroundColor(.secondary)
            }

            if let duration = session.duration {
                Text(formatDuration(duration))
                    .font(.caption)
                    .foregroundColor(.secondary)
            }

            HStack(spacing: 0) {
                StatView(label: "신청", value: "\(session.stats.totalRequests)")
                Spacer()
                StatView(label: "완료", value: "\(session.stats.completedCount)")
                Spacer()
                StatView(label: "거절", value: "\(session.stats.rejectedCount)")
                if session.stats.totalDonation > 0 {
                    Spacer()
                    StatView(label: "후원", value: "\(session.stats.totalDonation)")
                }
            }

            Button(action: onClone) {
                Text("이 세션 복원")
                    .font(.subheadline.bold())
                    .frame(maxWidth: .infinity)
                    .padding(.vertical, 10)
            }
            .buttonStyle(.bordered)
        }
        .padding()
        .background(Color(.secondarySystemGroupedBackground))
        .cornerRadius(12)
    }

    private static let displayFormatter: DateFormatter = {
        let f = DateFormatter()
        f.dateFormat = "yyyy-MM-dd HH:mm"
        f.timeZone = .current
        return f
    }()

    private func formatDate(_ isoDate: String) -> String {
        guard let date = parseISO8601(isoDate) else { return String(isoDate.prefix(10)) }
        return Self.displayFormatter.string(from: date)
    }

    private func formatDuration(_ minutes: Int) -> String {
        let hours = minutes / 60
        let mins = minutes % 60
        return hours > 0 ? "\(hours)시간 \(mins)분" : "\(mins)분"
    }
}

private struct StatView: View {
    let label: String
    let value: String

    var body: some View {
        VStack(spacing: 2) {
            Text(value)
                .font(.title3.bold())
            Text(label)
                .font(.caption)
                .foregroundColor(.secondary)
        }
    }
}

// MARK: - LinkedIn-style Tab Bar
private struct ConsoleTabBar: View {
    @Binding var selectedTab: ConsoleTab
    @Namespace private var namespace

    var body: some View {
        HStack(spacing: 0) {
            ForEach(ConsoleTab.allCases, id: \.self) { tab in
                Button {
                    withAnimation(.easeInOut(duration: 0.25)) {
                        selectedTab = tab
                    }
                } label: {
                    VStack(spacing: 10) {
                        Text(tab.rawValue)
                            .font(.subheadline.weight(selectedTab == tab ? .bold : .regular))
                            .foregroundColor(selectedTab == tab ? .primary : .secondary)

                        ZStack(alignment: .bottom) {
                            Rectangle()
                                .fill(Color.clear)
                                .frame(height: 2)

                            if selectedTab == tab {
                                Rectangle()
                                    .fill(Color.primary)
                                    .frame(height: 2)
                                    .matchedGeometryEffect(id: "console_underline", in: namespace)
                            }
                        }
                    }
                }
                .buttonStyle(.plain)
                .frame(maxWidth: .infinity)
            }
        }
        .padding(.horizontal)
        .padding(.top, 12)
        .background(
            VStack {
                Spacer()
                Divider()
            }
        )
        .animation(.easeInOut(duration: 0.25), value: selectedTab)
    }
}
