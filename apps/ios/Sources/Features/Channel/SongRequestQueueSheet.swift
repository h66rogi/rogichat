import SwiftUI
import Kingfisher

struct SongRequestQueueSheet: View {
    @ObservedObject var manager: SongRequestManager
    @Environment(\.dismiss) private var dismiss
    @State private var showsScrollToTop = false

    private let scrollTopID = "song-request-queue-top"
    private let scrollCoordinateSpace = "song-request-queue-scroll"

    var body: some View {
        NavigationStack {
            ScrollViewReader { proxy in
                ZStack(alignment: .bottomTrailing) {
                    ScrollView {
                        VStack(spacing: 0) {
                            GeometryReader { geometry in
                                Color.clear.preference(
                                    key: SongRequestScrollOffsetPreferenceKey.self,
                                    value: geometry.frame(in: .named(scrollCoordinateSpace)).minY
                                )
                            }
                            .frame(height: 0)
                            .id(scrollTopID)

                            // Status Banner
                            statusBanner
                                .padding(.horizontal)
                                .padding(.top, 8)

                            // Queue Info
                            queueInfoCard
                                .padding(.horizontal)
                                .padding(.top, 20)

                            // Info Message
                            Text(infoText)
                                .font(.caption)
                                .foregroundColor(manager.canRequest ? Color(red: 0.06, green: 0.73, blue: 0.51) : .secondary)
                                .frame(maxWidth: .infinity, alignment: .leading)
                                .padding(.horizontal)
                                .padding(.top, 16)

                            Divider()
                                .padding(.top, 20)
                                .padding(.horizontal)

                            // Queue List
                            queueList
                                .padding(.top, 16)
                                .padding(.horizontal)
                        }
                        .padding(.bottom, 88)
                    }
                    .coordinateSpace(name: scrollCoordinateSpace)
                    .onPreferenceChange(SongRequestScrollOffsetPreferenceKey.self) { offset in
                        showsScrollToTop = offset < -160
                    }

                    if showsScrollToTop {
                        Button {
                            withAnimation(.easeOut(duration: 0.25)) {
                                proxy.scrollTo(scrollTopID, anchor: .top)
                            }
                        } label: {
                            Label("맨 위로", systemImage: "arrow.up")
                                .font(.subheadline.weight(.semibold))
                        }
                        .buttonStyle(.borderedProminent)
                        .tint(.purple)
                        .padding(.trailing, 16)
                        .padding(.bottom, 16)
                        .transition(.opacity.combined(with: .scale))
                    }
                }
                .animation(.easeOut(duration: 0.2), value: showsScrollToTop)
                .navigationTitle("신청곡 현황")
                .navigationBarTitleDisplayMode(.inline)
                .toolbar {
                    ToolbarItem(placement: .cancellationAction) {
                        Button("닫기") { dismiss() }
                    }
                }
            }
        }
        .task {
            await manager.fetchQueue()
        }
    }

    // MARK: - Status Banner

    private var statusBanner: some View {
        HStack(spacing: 10) {
            Circle()
                .fill(.white.opacity(0.24))
                .frame(width: 30, height: 30)
                .overlay(
                    Image(systemName: "antenna.radiowaves.left.and.right")
                        .font(.system(size: 14))
                        .foregroundColor(.white)
                )

            Text(manager.isPaused ? "신청곡 일시정지" : "신청곡 받는 중")
                .font(.subheadline.weight(.bold))
                .foregroundColor(.white)

            Spacer()
        }
        .padding(.horizontal, 16)
        .padding(.vertical, 14)
        .background(
            LinearGradient(
                colors: manager.isPaused
                    ? [Color(red: 0.61, green: 0.64, blue: 0.67), Color(red: 0.42, green: 0.44, blue: 0.47)]
                    : [Color(red: 0.85, green: 0.27, blue: 0.94), Color(red: 0.93, green: 0.29, blue: 0.6), Color(red: 0.55, green: 0.36, blue: 0.96)],
                startPoint: .leading,
                endPoint: .trailing
            )
        )
        .cornerRadius(12)
    }

    // MARK: - Queue Info Card

    private var queueInfoCard: some View {
        HStack {
            VStack(alignment: .leading, spacing: 4) {
                Text("대기열 현황")
                    .font(.caption)
                    .foregroundColor(.secondary)

                HStack(alignment: .lastTextBaseline, spacing: 2) {
                    Text("\(manager.queueCount)")
                        .font(.title.weight(.bold))

                    if manager.maxQueueSize > 0 {
                        Text("/ \(manager.maxQueueSize)")
                            .font(.callout)
                            .foregroundColor(.secondary)
                    }
                }
            }

            Spacer()

            if manager.isQueueFull {
                Text("대기열 가득")
                    .font(.caption2.weight(.semibold))
                    .foregroundColor(.white)
                    .padding(.horizontal, 10)
                    .padding(.vertical, 4)
                    .background(Color.red)
                    .cornerRadius(999)
            }
        }
        .padding(16)
        .background(Color(.systemGray6))
        .cornerRadius(12)
    }

    // MARK: - Info Text

    private var infoText: String {
        if manager.isPaused {
            return "신청곡이 일시정지 상태입니다. 잠시 후 다시 시도해 주세요."
        } else if manager.isQueueFull {
            return "대기열이 가득 찼습니다. 잠시 후 다시 시도해 주세요."
        } else if manager.canRequest {
            return "신청곡을 받고 있습니다. 노래책에서 곡을 선택하여 신청해 주세요."
        } else {
            return "현재 신청곡을 받을 수 없습니다."
        }
    }

    // MARK: - Queue List

    private var queueList: some View {
        VStack(alignment: .leading, spacing: 12) {
            Text("대기열")
                .font(.subheadline.weight(.semibold))

            if manager.isLoadingQueue {
                HStack {
                    Spacer()
                    ProgressView()
                        .frame(height: 120)
                    Spacer()
                }
            } else if manager.queueItems.isEmpty {
                HStack {
                    Spacer()
                    Text("대기 중인 신청곡이 없습니다")
                        .font(.caption)
                        .foregroundColor(.secondary)
                        .frame(height: 120)
                    Spacer()
                }
            } else {
                VStack(spacing: 8) {
                    ForEach(Array(manager.queueItems.enumerated()), id: \.element.id) { index, item in
                        QueueItemRow(index: index + 1, item: item)
                    }
                }
            }
        }
    }
}

private struct SongRequestScrollOffsetPreferenceKey: PreferenceKey {
    static let defaultValue: CGFloat = 0

    static func reduce(value: inout CGFloat, nextValue: () -> CGFloat) {
        value = nextValue()
    }
}

// MARK: - Queue Item Row

private struct QueueItemRow: View {
    let index: Int
    let item: SongRequestQueueItem

    private var isPlaying: Bool { item.status == "PLAYING" }

    var body: some View {
        HStack(spacing: 12) {
            // Position number
            Circle()
                .fill(isPlaying ? Color(red: 0.85, green: 0.27, blue: 0.94) : Color(.systemGray4))
                .frame(width: 28, height: 28)
                .overlay(
                    Text("\(index)")
                        .font(.caption2.weight(.bold))
                        .foregroundColor(isPlaying ? .white : .primary)
                )

            // Album art
            KFImage(ChannelEnvironment.imageURL(item.songAlbumArt ?? ""))
                .placeholder {
                    RoundedRectangle(cornerRadius: 6)
                        .fill(Color(.systemGray5))
                        .overlay(
                            Image(systemName: "music.note")
                                .font(.caption)
                                .foregroundColor(.gray)
                        )
                }
                .resizable()
                .aspectRatio(contentMode: .fill)
                .frame(width: 40, height: 40)
                .cornerRadius(6)

            // Song info
            VStack(alignment: .leading, spacing: 2) {
                Text(item.displayTitle)
                    .font(.subheadline.weight(.semibold))
                    .lineLimit(1)

                Text(item.displayArtist)
                    .font(.caption)
                    .foregroundColor(.secondary)
                    .lineLimit(1)

                Text("by \(item.requesterNickname)")
                    .font(.caption2)
                    .foregroundColor(.secondary.opacity(0.7))
                    .lineLimit(1)
            }

            Spacer()

            // Status badge
            Text(item.statusLabel)
                .font(.caption2.weight(.semibold))
                .foregroundColor(isPlaying ? Color(red: 0.85, green: 0.27, blue: 0.94) : .secondary)
        }
        .padding(12)
        .background(Color(.systemGray6))
        .cornerRadius(12)
    }
}
