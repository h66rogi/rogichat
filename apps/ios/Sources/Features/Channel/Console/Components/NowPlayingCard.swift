import SwiftUI
import Kingfisher

struct NowPlayingCard: View {
    let request: ConsoleSongRequest
    let onPlayNext: () -> Void
    let onSkip: () -> Void

    var body: some View {
        HStack(spacing: 12) {
            albumArtView

            VStack(alignment: .leading, spacing: 2) {
                Text(request.displayTitle)
                    .font(.subheadline.bold())
                    .lineLimit(1)

                Text(request.displayArtist)
                    .font(.caption)
                    .opacity(0.8)
                    .lineLimit(1)

                Text(request.requesterNickname)
                    .font(.caption2)
                    .opacity(0.6)
                    .lineLimit(1)
            }

            Spacer()

            HStack(spacing: 8) {
                Button {
                    onPlayNext()
                } label: {
                    Text("다음곡")
                        .font(.caption.bold())
                        .padding(.horizontal, 10)
                        .padding(.vertical, 6)
                }
                .buttonStyle(.bordered)
                .tint(.primary)
                .buttonBorderShape(.roundedRectangle(radius: 6))

                Button {
                    onSkip()
                } label: {
                    Text("스킵")
                        .font(.caption.bold())
                        .padding(.horizontal, 10)
                        .padding(.vertical, 6)
                }
                .buttonStyle(.bordered)
                .tint(.red)
                .buttonBorderShape(.roundedRectangle(radius: 6))
            }
        }
        .padding(12)
        .background(
            RoundedRectangle(cornerRadius: 12)
                .fill(Color(.secondarySystemGroupedBackground))
        )
    }

    @ViewBuilder
    private var albumArtView: some View {
        if let urlString = request.albumArt, let url = URL(string: urlString) {
            KFImage(url)
                .resizable()
                .placeholder {
                    albumArtPlaceholder
                }
                .aspectRatio(contentMode: .fill)
                .frame(width: 48, height: 48)
                .cornerRadius(8)
        } else {
            albumArtPlaceholder
        }
    }

    private var albumArtPlaceholder: some View {
        RoundedRectangle(cornerRadius: 8)
            .fill(Color(.systemGray4))
            .frame(width: 48, height: 48)
            .overlay(
                Image(systemName: "music.note")
                    .foregroundColor(.secondary)
            )
    }
}
