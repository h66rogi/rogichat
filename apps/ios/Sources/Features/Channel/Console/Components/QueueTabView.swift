import SwiftUI

struct QueueTabView: View {
    let queue: [ConsoleSongRequest]
    let onPlayNow: (Int) -> Void
    let onDelete: (Int) -> Void
    let onMoveUp: (Int) -> Void
    let onMoveDown: (Int) -> Void
    let onClearAll: () -> Void

    var body: some View {
        if queue.isEmpty {
            emptyState
        } else {
            queueList
        }
    }

    private var emptyState: some View {
        Text("대기열이 비어있습니다")
            .font(.subheadline)
            .foregroundColor(.secondary)
            .frame(maxWidth: .infinity, maxHeight: .infinity)
    }

    private var queueList: some View {
        ScrollView {
            LazyVStack(spacing: 0) {
                ForEach(Array(queue.enumerated()), id: \.element.id) { index, item in
                    ConsoleQueueItemRow(
                        request: item,
                        index: index,
                        totalCount: queue.count,
                        onPlayNow: { onPlayNow(item.id) },
                        onDelete: { onDelete(item.id) },
                        onMoveUp: { onMoveUp(item.id) },
                        onMoveDown: { onMoveDown(item.id) }
                    )

                    if index < queue.count - 1 {
                        Divider()
                            .padding(.horizontal, 16)
                            .opacity(0.5)
                    }
                }

                Divider()
                    .padding(.top, 8)

                Button(role: .destructive) {
                    onClearAll()
                } label: {
                    Label("전체 초기화", systemImage: "trash")
                        .font(.subheadline)
                }
                .padding(.vertical, 12)

                Spacer().frame(height: 80)
            }
        }
    }
}
