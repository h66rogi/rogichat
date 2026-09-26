import SwiftUI

struct HistoryTabView: View {
    let history: [ConsoleSongRequest]

    var body: some View {
        if history.isEmpty {
            emptyState
        } else {
            historyList
        }
    }

    private var emptyState: some View {
        Text("히스토리가 비어있습니다")
            .font(.subheadline)
            .foregroundColor(.secondary)
            .frame(maxWidth: .infinity, maxHeight: .infinity)
    }

    private var historyList: some View {
        List {
            ForEach(history) { item in
                HStack(spacing: 12) {
                    VStack(alignment: .leading, spacing: 2) {
                        Text(item.displayTitle)
                            .font(.subheadline)
                            .lineLimit(1)

                        Text(item.displayArtist)
                            .font(.caption)
                            .foregroundColor(.secondary)
                            .lineLimit(1)

                        Text(item.requesterNickname)
                            .font(.caption2)
                            .foregroundColor(.secondary)
                            .lineLimit(1)
                    }

                    Spacer()

                    VStack(alignment: .trailing, spacing: 4) {
                        statusBadge(for: item)

                        if let reason = item.rejectionReason, !reason.isEmpty {
                            Text(reason)
                                .font(.caption2)
                                .foregroundColor(.red)
                                .lineLimit(1)
                        }
                    }
                }
                .padding(.vertical, 4)
            }
        }
        .listStyle(.plain)
    }

    @ViewBuilder
    private func statusBadge(for item: ConsoleSongRequest) -> some View {
        let (label, color) = statusInfo(for: item)
        Text(label)
            .font(.caption2.bold())
            .foregroundColor(color)
            .padding(.horizontal, 8)
            .padding(.vertical, 3)
            .background(
                Capsule()
                    .fill(color.opacity(0.15))
            )
    }

    private func statusInfo(for item: ConsoleSongRequest) -> (String, Color) {
        if item.isCompleted {
            return (item.statusLabel, .green)
        } else if item.isRejected {
            return (item.statusLabel, .red)
        } else {
            return (item.statusLabel, .secondary)
        }
    }
}
