import SwiftUI
import Kingfisher

struct SongDetailSheet: View {
    let song: Song
    let channelIdentifier: String
    let permission: ChannelPermissionResponse?
    var pricingSettings: PricingSettings?
    var songRequestManager: SongRequestManager?
    var onRequest: (() -> Void)?
    var onLikeToggle: (() -> Void)?
    var onEdit: (() -> Void)?
    var onDelete: (() -> Void)?
    var onSongUpdated: ((Song) -> Void)?

    @Environment(\.dismiss) private var dismiss
    @Environment(\.openURL) private var openURL
    @State private var isExpanded = false

    private var canViewLyrics: Bool {
        guard let permission = permission else { return false }
        return permission.isOwner || permission.manageContent || permission.manageSettings
    }

    private var canEdit: Bool {
        guard let permission = permission else { return false }
        return permission.manageContent || permission.isOwner
    }

    private var priceItems: [SongRequestPriceItem] {
        let input = SongPriceInput(
            price: song.price,
            currencyPrices: song.currencyPrices,
            difficulty: song.difficulty,
            categories: song.categories
        )
        return SongPriceCalculator.getPriceItems(song: input, settings: pricingSettings)
    }

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(spacing: 20) {
                    // MARK: - Header (Album Art + Title + Artist)
                    headerSection

                    // MARK: - Categories
                    if !song.categories.isEmpty {
                        categoriesSection
                    }

                    // MARK: - Description
                    if let description = song.description, !description.isEmpty {
                        descriptionSection(description)
                    }

                    // MARK: - Price
                    if !priceItems.isEmpty {
                        priceSectionView
                    }

                    // MARK: - Music Info (Difficulty, Key, BPM)
                    musicInfoSection

                    // MARK: - Links
                    linksSection

                    // MARK: - Lyrics/Memo
                    lyricsSection

                    // MARK: - Song Request
                    if let manager = songRequestManager, manager.showRequestUI {
                        requestSection(manager: manager)
                    }

                    // MARK: - Like Section
                    likeSection
                }
                .padding()
            }
            .navigationTitle("노래 상세")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("닫기") {
                        dismiss()
                    }
                }

                if canEdit {
                    ToolbarItem(placement: .confirmationAction) {
                        Menu {
                            Button {
                                onEdit?()
                            } label: {
                                Label("수정", systemImage: "pencil")
                            }

                            Button(role: .destructive) {
                                onDelete?()
                            } label: {
                                Label("삭제", systemImage: "trash")
                            }
                        } label: {
                            Image(systemName: "ellipsis.circle")
                        }
                    }
                }
            }
        }
    }

    // MARK: - Header Section
    private var headerSection: some View {
        VStack(spacing: 16) {
            // Album Art
            KFImage(ChannelEnvironment.imageURL(song.albumArt ?? ""))
                .placeholder {
                    RoundedRectangle(cornerRadius: 12)
                        .fill(Color.gray.opacity(0.2))
                        .overlay(
                            Image(systemName: "music.note")
                                .font(.system(size: 40))
                                .foregroundColor(.gray)
                        )
                }
                .resizable()
                .aspectRatio(contentMode: .fill)
                .frame(width: 180, height: 180)
                .cornerRadius(12)
                .shadow(radius: 4)

            // Title
            Text(song.title)
                .font(.title2.bold())
                .multilineTextAlignment(.center)

            // Artist
            Text(song.artist.name)
                .font(.subheadline)
                .foregroundColor(.secondary)
        }
    }

    // MARK: - Categories Section
    private var categoriesSection: some View {
        VStack(alignment: .leading, spacing: 8) {
            Text("카테고리")
                .font(.caption)
                .foregroundColor(.secondary)

            FlowLayout(spacing: 8) {
                ForEach(song.categories) { category in
                    HStack(spacing: 4) {
                        Circle()
                            .fill(Color(hex: category.color ?? "#6b7280"))
                            .frame(width: 8, height: 8)
                        Text(category.name)
                            .font(.subheadline)
                    }
                    .padding(.horizontal, 12)
                    .padding(.vertical, 6)
                    .background(Color(hex: category.color ?? "#6b7280").opacity(0.15))
                    .cornerRadius(16)
                }
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
    }

    // MARK: - Description Section
    private func descriptionSection(_ description: String) -> some View {
        VStack(alignment: .leading, spacing: 8) {
            Text("설명")
                .font(.caption)
                .foregroundColor(.secondary)

            Text(description)
                .font(.subheadline)
                .frame(maxWidth: .infinity, alignment: .leading)
                .padding()
                .background(Color(.systemGray6))
                .cornerRadius(8)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
    }

    // MARK: - Price Section
    private var priceSectionView: some View {
        VStack(alignment: .leading, spacing: 8) {
            Text("신청 가격")
                .font(.caption)
                .foregroundColor(.secondary)

            HStack(spacing: 8) {
                ForEach(Array(priceItems.enumerated()), id: \.offset) { _, item in
                    HStack(spacing: 4) {
                        Image(systemName: "music.note")
                            .font(.caption)
                            .foregroundColor(.orange)
                        if let price = item.price {
                            Text("\(price) \(item.unit)")
                                .font(.subheadline.weight(.medium))
                        } else {
                            Text("무료")
                                .font(.subheadline.weight(.medium))
                                .foregroundColor(.secondary)
                        }
                    }
                    .padding(.horizontal, 12)
                    .padding(.vertical, 8)
                    .background(Color.orange.opacity(0.1))
                    .cornerRadius(8)
                }
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
    }

    // MARK: - Music Info Section
    private var musicInfoSection: some View {
        VStack(spacing: 12) {
            HStack(spacing: 0) {
                // Difficulty
                VStack(spacing: 4) {
                    Text("난이도")
                        .font(.caption)
                        .foregroundColor(.secondary)
                    if let difficulty = song.difficulty, difficulty > 0 {
                        HStack(spacing: 2) {
                            ForEach(1...5, id: \.self) { star in
                                Image(systemName: star <= difficulty ? "star.fill" : "star")
                                    .font(.system(size: 12))
                                    .foregroundColor(star <= difficulty ? .yellow : .gray.opacity(0.3))
                            }
                        }
                    } else {
                        Text("-")
                            .font(.subheadline)
                            .foregroundColor(.secondary)
                    }
                }
                .frame(maxWidth: .infinity)

                Divider()
                    .frame(height: 40)

                // Key
                VStack(spacing: 4) {
                    Text("키")
                        .font(.caption)
                        .foregroundColor(.secondary)
                    Text(song.songKey ?? "-")
                        .font(.subheadline.weight(.medium))
                }
                .frame(maxWidth: .infinity)

                Divider()
                    .frame(height: 40)

                // BPM
                VStack(spacing: 4) {
                    Text("BPM")
                        .font(.caption)
                        .foregroundColor(.secondary)
                    if let bpm = song.bpm {
                        Text("\(bpm)")
                            .font(.subheadline.weight(.medium))
                    } else {
                        Text("-")
                            .font(.subheadline)
                            .foregroundColor(.secondary)
                    }
                }
                .frame(maxWidth: .infinity)
            }
            .padding()
            .background(Color(.systemGray6))
            .cornerRadius(12)
        }
    }

    // MARK: - Links Section
    private var linksSection: some View {
        VStack(alignment: .leading, spacing: 8) {
            Text("링크")
                .font(.caption)
                .foregroundColor(.secondary)

            VStack(spacing: 8) {
                if let lyricsLink = song.lyricsLink, !lyricsLink.isEmpty, let url = URL(string: lyricsLink) {
                    LinkButton(
                        title: "가사 보기",
                        icon: "text.quote",
                        color: .purple
                    ) {
                        openURL(url)
                    }
                }

                if let karaokeUrl = song.karaokeUrl, !karaokeUrl.isEmpty, let url = URL(string: karaokeUrl) {
                    LinkButton(
                        title: "노래방",
                        icon: "music.mic",
                        color: .orange
                    ) {
                        openURL(url)
                    }
                }

                if let originalUrl = song.originalUrl, !originalUrl.isEmpty, let url = URL(string: originalUrl) {
                    LinkButton(
                        title: "원곡",
                        icon: "play.circle",
                        color: .red
                    ) {
                        openURL(url)
                    }
                }

                if let coverUrl = song.coverUrl, !coverUrl.isEmpty, let url = URL(string: coverUrl) {
                    LinkButton(
                        title: "커버",
                        icon: "mic.fill",
                        color: .blue
                    ) {
                        openURL(url)
                    }
                }

                // Show empty state if no links
                if !hasAnyLink {
                    Text("등록된 링크가 없습니다")
                        .font(.subheadline)
                        .foregroundColor(.secondary)
                        .frame(maxWidth: .infinity)
                        .padding()
                        .background(Color(.systemGray6))
                        .cornerRadius(8)
                }
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
    }

    private var hasAnyLink: Bool {
        let hasLyrics = song.lyricsLink?.isEmpty == false
        let hasKaraoke = song.karaokeUrl?.isEmpty == false
        let hasOriginal = song.originalUrl?.isEmpty == false
        let hasCover = song.coverUrl?.isEmpty == false
        return hasLyrics || hasKaraoke || hasOriginal || hasCover
    }

    // MARK: - Lyrics Section
    private var lyricsSection: some View {
        VStack(alignment: .leading, spacing: 8) {
            HStack {
                Text("메모")
                    .font(.caption)
                    .foregroundColor(.secondary)

                if !canViewLyrics {
                    Image(systemName: "lock.fill")
                        .font(.caption2)
                        .foregroundColor(.secondary)
                }
            }

            if canViewLyrics {
                if let lyricsText = song.lyricsText, !lyricsText.isEmpty {
                    VStack(alignment: .leading, spacing: 8) {
                        Text(lyricsText)
                            .font(.subheadline)
                            .lineLimit(isExpanded ? nil : 4)
                            .frame(maxWidth: .infinity, alignment: .leading)

                        if lyricsText.count > 100 {
                            Button {
                                withAnimation {
                                    isExpanded.toggle()
                                }
                            } label: {
                                Text(isExpanded ? "접기" : "더보기")
                                    .font(.caption)
                                    .foregroundColor(.accentColor)
                            }
                        }
                    }
                    .padding()
                    .background(Color(.systemGray6))
                    .cornerRadius(8)
                } else {
                    Text("등록된 메모가 없습니다")
                        .font(.subheadline)
                        .foregroundColor(.secondary)
                        .frame(maxWidth: .infinity)
                        .padding()
                        .background(Color(.systemGray6))
                        .cornerRadius(8)
                }
            } else {
                HStack {
                    Image(systemName: "lock.fill")
                        .foregroundColor(.secondary)
                    Text("메모는 채널 소유자 또는 매니저만 볼 수 있어요")
                        .font(.subheadline)
                        .foregroundColor(.secondary)
                }
                .frame(maxWidth: .infinity)
                .padding()
                .background(Color(.systemGray6))
                .cornerRadius(8)
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
    }

    // MARK: - Request Section
    private func requestSection(manager: SongRequestManager) -> some View {
        let blocked = manager.isBlockedCategory(song: song)
        let duplicate = manager.isDuplicateRequest(songId: song.id)
        let canSubmit = manager.canRequest && !manager.isSubmitting && !blocked && !duplicate

        return VStack(spacing: 12) {
            Divider()

            Button {
                onRequest?()
            } label: {
                HStack(spacing: 8) {
                    Image(systemName: "music.note.list")
                    Text(requestButtonLabel(manager: manager, isBlockedCategory: blocked, isDuplicateRequest: duplicate))
                        .fontWeight(.semibold)
                }
                .frame(maxWidth: .infinity)
                .padding(.vertical, 14)
                .background(canSubmit ? Color.purple : Color.gray.opacity(0.3))
                .foregroundColor(canSubmit ? .white : .secondary)
                .cornerRadius(12)
            }
            .buttonStyle(.plain)
            .disabled(!canSubmit)
        }
    }

    private func requestButtonLabel(manager: SongRequestManager, isBlockedCategory: Bool = false, isDuplicateRequest: Bool = false) -> String {
        if isBlockedCategory { return "신청 불가 카테고리" }
        if isDuplicateRequest { return "이미 신청된 곡" }
        if manager.isSubmitting { return "신청중..." }
        if manager.isPaused { return "일시정지" }
        if manager.isQueueFull { return "대기열이 가득 찼습니다" }
        return "이 노래 신청하기"
    }

    // MARK: - Like Section
    private var likeSection: some View {
        VStack(spacing: 12) {
            Divider()

            HStack {
                VStack(alignment: .leading, spacing: 4) {
                    Text("좋아요")
                        .font(.caption)
                        .foregroundColor(.secondary)
                    Text("\(song.likeCount)명이 좋아합니다")
                        .font(.subheadline)
                }

                Spacer()

                Button {
                    onLikeToggle?()
                } label: {
                    HStack(spacing: 6) {
                        Image(systemName: song.isLiked ? "heart.fill" : "heart")
                        Text(song.isLiked ? "좋아요 취소" : "좋아요")
                    }
                    .font(.subheadline.weight(.medium))
                    .foregroundColor(song.isLiked ? .white : .red)
                    .padding(.horizontal, 16)
                    .padding(.vertical, 10)
                    .background(song.isLiked ? Color.red : Color.red.opacity(0.1))
                    .cornerRadius(20)
                }
            }
        }
    }
}

// MARK: - Link Button
private struct LinkButton: View {
    let title: String
    let icon: String
    let color: Color
    let action: () -> Void

    var body: some View {
        Button(action: action) {
            HStack {
                Image(systemName: icon)
                    .foregroundColor(color)
                    .frame(width: 24)

                Text(title)
                    .font(.subheadline)
                    .foregroundColor(.primary)

                Spacer()

                Image(systemName: "arrow.up.right")
                    .font(.caption)
                    .foregroundColor(.secondary)
            }
            .padding()
            .background(Color(.systemGray6))
            .cornerRadius(8)
        }
        .buttonStyle(.plain)
    }
}
