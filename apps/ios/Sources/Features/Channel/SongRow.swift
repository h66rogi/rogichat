import SwiftUI

struct SongRow: View {
    let song: Song
    var onTap: (() -> Void)?

    var body: some View {
        Button(action: { onTap?() }) {
            HStack(spacing: 12) {
                // Album Art
                AsyncImage(url: song.albumArt.flatMap(ChannelImageURL.resolve)) { image in
                    image.resizable().aspectRatio(contentMode: .fill)
                } placeholder: {
                        RoundedRectangle(cornerRadius: 8)
                            .fill(Color.gray.opacity(0.2))
                            .overlay(
                                Image(systemName: "music.note")
                                    .foregroundColor(.gray)
                            )
                }
                .frame(width: 56, height: 56)
                .clipShape(RoundedRectangle(cornerRadius: 8))

                // Info
                VStack(alignment: .leading, spacing: 4) {
                    Text(song.title)
                        .font(.subheadline.weight(.medium))
                        .foregroundColor(.primary)
                        .lineLimit(1)

                    HStack(spacing: 6) {
                        Text(song.artist.name)
                            .font(.caption)
                            .foregroundColor(.secondary)
                            .lineLimit(1)

                        if let difficulty = song.difficulty, difficulty > 0 {
                            HStack(spacing: 1) {
                                ForEach(1...difficulty, id: \.self) { _ in
                                    Image(systemName: "star.fill")
                                        .font(.system(size: 8))
                                        .foregroundColor(.yellow)
                                }
                            }
                        }
                    }

                    // Categories
                    if !song.categories.isEmpty {
                        HStack(spacing: 4) {
                            ForEach(song.categories.prefix(2)) { category in
                                Text(category.name)
                                    .font(.caption2)
                                    .padding(.horizontal, 6)
                                    .padding(.vertical, 2)
                                    .background(Color(hex: category.color ?? "#6b7280").opacity(0.2))
                                    .foregroundColor(Color(hex: category.color ?? "#6b7280"))
                                    .cornerRadius(4)
                            }
                        }
                    }
                }

                Spacer()

            }
            .padding(.vertical, 4)
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
    }

}

struct CopyToastModel: Equatable, Identifiable {
    let id = UUID()
    let title: String
    let description: String?
}

struct CopyToastView: View {
    let toast: CopyToastModel

    var body: some View {
        HStack(spacing: 10) {
            Image(systemName: "doc.on.clipboard.fill")
                .font(.subheadline)
                .foregroundColor(.accentColor)

            VStack(alignment: .leading, spacing: 2) {
                Text(toast.title)
                    .font(.subheadline.weight(.medium))
                    .foregroundColor(.primary)
                    .lineLimit(1)
                if let description = toast.description, !description.isEmpty {
                    Text(description)
                        .font(.caption)
                        .foregroundColor(.secondary)
                        .lineLimit(1)
                }
            }

            Spacer(minLength: 0)
        }
        .padding(.horizontal, 14)
        .padding(.vertical, 10)
        .background(
            RoundedRectangle(cornerRadius: 12)
                .fill(Color(.systemBackground))
                .shadow(color: Color.black.opacity(0.15), radius: 8, x: 0, y: 2)
        )
        .overlay(
            RoundedRectangle(cornerRadius: 12)
                .strokeBorder(Color(.separator).opacity(0.5), lineWidth: 0.5)
        )
    }
}
