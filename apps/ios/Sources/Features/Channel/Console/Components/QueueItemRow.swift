import SwiftUI
import Kingfisher

struct ConsoleQueueItemRow: View {
    let request: ConsoleSongRequest
    let index: Int
    let totalCount: Int
    let onPlayNow: () -> Void
    let onDelete: () -> Void
    let onMoveUp: () -> Void
    let onMoveDown: () -> Void

    var body: some View {
        HStack(spacing: 12) {
            albumArtView

            VStack(alignment: .leading, spacing: 2) {
                Text(request.displayTitle)
                    .font(.subheadline.weight(.semibold))
                    .lineLimit(1)

                Text(request.displayArtist)
                    .font(.caption)
                    .foregroundColor(.secondary)
                    .lineLimit(1)

                HStack(spacing: 6) {
                    Text(request.requesterNickname)
                        .font(.caption2)
                        .foregroundColor(.secondary.opacity(0.7))
                        .lineLimit(1)

                    badges
                }
            }

            Spacer()

            actionButtons
        }
        .padding(.horizontal, 16)
        .padding(.vertical, 8)
    }

    // MARK: - Action Buttons

    private var actionButtons: some View {
        HStack(spacing: 0) {
            Button {
                onMoveUp()
            } label: {
                Image(systemName: "arrow.up")
                    .font(.caption)
                    .frame(width: 32, height: 32)
            }
            .disabled(index <= 0)
            .foregroundColor(index > 0 ? .secondary : .secondary.opacity(0.3))

            Button {
                onMoveDown()
            } label: {
                Image(systemName: "arrow.down")
                    .font(.caption)
                    .frame(width: 32, height: 32)
            }
            .disabled(index >= totalCount - 1)
            .foregroundColor(index < totalCount - 1 ? .secondary : .secondary.opacity(0.3))

            Button {
                onPlayNow()
            } label: {
                Image(systemName: "play.fill")
                    .font(.caption)
                    .frame(width: 32, height: 32)
            }
            .foregroundColor(.accentColor)

            Button {
                onDelete()
            } label: {
                Image(systemName: "trash")
                    .font(.caption)
                    .frame(width: 32, height: 32)
            }
            .foregroundColor(.red)
        }
        .buttonStyle(.plain)
    }

    // MARK: - Album Art

    @ViewBuilder
    private var albumArtView: some View {
        if let urlString = request.albumArt, let url = URL(string: urlString) {
            KFImage(url)
                .resizable()
                .placeholder {
                    albumArtPlaceholder
                }
                .aspectRatio(contentMode: .fill)
                .frame(width: 40, height: 40)
                .clipShape(Circle())
        } else {
            albumArtPlaceholder
        }
    }

    private var albumArtPlaceholder: some View {
        Circle()
            .fill(Color(.systemGray5))
            .frame(width: 40, height: 40)
            .overlay(
                Image(systemName: "music.note")
                    .font(.caption)
                    .foregroundColor(.secondary)
            )
    }

    // MARK: - Badges

    @ViewBuilder
    private var badges: some View {
        if request.isDonation {
            Text("후원")
                .font(.caption2.bold())
                .foregroundColor(.orange)
                .padding(.horizontal, 6)
                .padding(.vertical, 2)
                .background(
                    Capsule()
                        .fill(Color.orange.opacity(0.15))
                )
        }

        if let formattedPrice = request.formattedPrice {
            Text(formattedPrice)
                .font(.caption2)
                .foregroundColor(.secondary)
                .padding(.horizontal, 6)
                .padding(.vertical, 2)
                .background(
                    Capsule()
                        .fill(Color.secondary.opacity(0.1))
                )
        } else if let price = request.calculatedPrice, price > 0 {
            Text("\(price)")
                .font(.caption2)
                .foregroundColor(.secondary)
                .padding(.horizontal, 6)
                .padding(.vertical, 2)
                .background(
                    Capsule()
                        .fill(Color.secondary.opacity(0.1))
                )
        }
    }
}
