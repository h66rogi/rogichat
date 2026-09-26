import AVKit
import Foundation
import Kingfisher
import SwiftUI

struct ChannelProfileHero: View {
    let channel: Channel
    let profile: ChannelProfile?
    let isFavorited: Bool
    let favoriteCount: Int
    let isOwner: Bool
    let onFavorite: () -> Void
    let onTalk: () -> Void
    let onEditProfile: () -> Void
    let onManage: () -> Void

    private var themeTint: Color {
        Color(hex: channel.themeColor)
    }

    private var description: String? {
        let source = profile?.homeDescription ?? profile?.description ?? channel.channelDescription
        guard let source else { return nil }
        let plain = source
            .replacingOccurrences(of: "<[^>]+>", with: "", options: .regularExpression)
            .trimmingCharacters(in: .whitespacesAndNewlines)
        return plain.isEmpty ? nil : plain
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 20) {
            HStack(alignment: .center, spacing: 18) {
                ChannelProfileAvatar(channel: channel, isLive: false)

                HStack(spacing: 0) {
                    ChannelProfileMetric(value: favoriteCount.formatted(), label: "즐겨찾기")
                    ChannelProfileMetric(value: "\(channel.songCount)", label: "노래")
                    ChannelProfileMetric(value: "\(channel.artistCount)", label: "아티스트")
                }
                .frame(maxWidth: .infinity)

            }

            VStack(alignment: .leading, spacing: 7) {
                HStack(spacing: 6) {
                    Text(channel.name)
                        .font(.headline.weight(.bold))
                        .lineLimit(1)

                    ChannelVerificationMark(channel: channel)
                }

                Text("@\(channel.webPath)")
                    .font(.subheadline)
                    .foregroundStyle(.secondary)

                if let description {
                    Text(description)
                        .font(.subheadline)
                        .foregroundStyle(.primary)
                        .lineLimit(3)
                        .fixedSize(horizontal: false, vertical: true)
                }


            }

            profileActions
        }
        .padding(20)
        .background {
            RoundedRectangle(cornerRadius: 26, style: .continuous)
                .fill(.ultraThinMaterial)
                .overlay {
                    RoundedRectangle(cornerRadius: 26, style: .continuous)
                        .fill(
                            LinearGradient(
                                colors: [themeTint.opacity(0.14), .clear, Color.accentColor.opacity(0.06)],
                                startPoint: .topLeading,
                                endPoint: .bottomTrailing
                            )
                        )
                }
        }
        .overlay {
            RoundedRectangle(cornerRadius: 26, style: .continuous)
                .stroke(
                    LinearGradient(
                        colors: [Color.white.opacity(0.62), themeTint.opacity(0.20), Color.primary.opacity(0.07)],
                        startPoint: .topLeading,
                        endPoint: .bottomTrailing
                    ),
                    lineWidth: 0.8
                )
        }
        .shadow(color: themeTint.opacity(0.10), radius: 18, y: 8)
        .padding(.horizontal, 12)
        .padding(.top, 12)
        .padding(.bottom, 18)
    }

    @ViewBuilder
    private var profileActions: some View {
        if isOwner {
            HStack(spacing: 10) {
                Button(action: onEditProfile) {
                    Label("채널 수정", systemImage: "pencil")
                        .frame(maxWidth: .infinity)
                }
                .buttonStyle(.borderedProminent)
                .tint(Color.accentColor)
                .accessibilityLabel("채널 프로필 수정")

                Button(action: onTalk) {
                    Label("채널톡", systemImage: "bubble.left.and.bubble.right")
                        .frame(maxWidth: .infinity)
                }
                .buttonStyle(.bordered)
                .tint(Color.accentColor)

                Button(action: onManage) {
                    Image(systemName: "slider.horizontal.3")
                        .frame(minWidth: 24)
                }
                .buttonStyle(.bordered)
                .tint(Color.accentColor)
                .accessibilityLabel("채널 관리")
            }
        } else {
            HStack(spacing: 8) {
                Button(action: onFavorite) {
                    Label("즐겨찾기", systemImage: isFavorited ? "star.fill" : "star")
                        .lineLimit(1)
                        .frame(maxWidth: .infinity)
                }
                .buttonStyle(ChannelGlassActionButtonStyle(tint: Color.accentColor))
                .accessibilityLabel(isFavorited ? "즐겨찾기 해제" : "즐겨찾기 추가")


                Button(action: onTalk) {
                    Image(systemName: "bubble.left.and.bubble.right.fill")
                }
                .buttonStyle(ChannelGlassActionButtonStyle(tint: Color.accentColor, compact: true))
                .accessibilityLabel("채널톡")


            }
        }
    }
}

private struct ChannelGlassActionButtonStyle: ButtonStyle {
    let tint: Color
    var compact = false

    func makeBody(configuration: Configuration) -> some View {
        configuration.label
            .font(.subheadline.weight(.semibold))
            .foregroundStyle(tint)
            .padding(.horizontal, compact ? 0 : 10)
            .frame(minWidth: compact ? 46 : nil, minHeight: 46)
            .background(.ultraThinMaterial, in: RoundedRectangle(cornerRadius: 15, style: .continuous))
            .overlay {
                RoundedRectangle(cornerRadius: 15, style: .continuous)
                    .fill(tint.opacity(configuration.isPressed ? 0.18 : 0.09))
            }
            .overlay {
                RoundedRectangle(cornerRadius: 15, style: .continuous)
                    .stroke(
                        LinearGradient(
                            colors: [Color.white.opacity(0.64), tint.opacity(0.26), Color.primary.opacity(0.06)],
                            startPoint: .topLeading,
                            endPoint: .bottomTrailing
                        ),
                        lineWidth: 0.8
                    )
            }
            .shadow(color: tint.opacity(0.10), radius: 7, y: 3)
            .scaleEffect(configuration.isPressed ? 0.97 : 1)
            .animation(.easeOut(duration: 0.16), value: configuration.isPressed)
    }
}

struct ChannelOwnerSectionAction: View {
    let title: String
    let systemImage: String
    let action: () -> Void

    var body: some View {
        HStack {
            Spacer()
            Button(action: action) {
                Label(title, systemImage: systemImage)
                    .font(.subheadline.weight(.semibold))
            }
            .buttonStyle(.bordered)
            .tint(Color.accentColor)
            .padding(.horizontal, 20)
        }
        .padding(.bottom, 4)
        .accessibilityHint("이 채널에 \(title)을 합니다")
    }
}

private struct ChannelProfileMetric: View {
    let value: String
    let label: String

    var body: some View {
        VStack(spacing: 3) {
            Text(value)
                .font(.subheadline.weight(.bold))
                .contentTransition(.numericText())
            Text(label)
                .font(.caption2)
                .foregroundStyle(.secondary)
        }
        .frame(maxWidth: .infinity)
        .accessibilityElement(children: .combine)
    }
}

private struct ChannelVerificationMark: View {
    let channel: Channel

    private var hasAmbassadorVerification: Bool {
        channel.verifications.contains {
            let platform = $0.platform.uppercased()
            return platform == "AMBASSADOR" || platform == "MELOMING_AMBASSADOR"
        }
    }

    private var hasVerification: Bool {
        hasAmbassadorVerification || !channel.verifications.isEmpty
    }

    var body: some View {
        HStack(spacing: 4) {
            if hasVerification {
                Image(systemName: "checkmark.seal.fill")
                    .font(.subheadline)
                    .foregroundStyle(Color.accentColor)
                    .accessibilityLabel(hasAmbassadorVerification ? "앰배서더 인증" : "인증 채널")
            }

            if channel.isOwnerProSubscriber {
                Label("PRO", systemImage: "crown.fill")
                    .font(.caption2.weight(.heavy))
                    .foregroundStyle(.white)
                    .padding(.horizontal, 6)
                    .padding(.vertical, 3)
                    .background(Color.accentColor, in: Capsule())
                    .accessibilityLabel("Pro 채널")
            }
        }
    }
}

private struct ChannelProfileAvatar: View {
    let channel: Channel
    let isLive: Bool
    @State private var isPulsing = false

    var body: some View {
        ZStack {
            if isLive {
                Circle()
                    .fill(
                        AngularGradient(
                            colors: [
                                ChannelNativePalette.huyeorAmber,
                                .red,
                                .pink,
                                ChannelNativePalette.huyeorAmber
                            ],
                            center: .center
                        )
                    )
                    .padding(-4)
                    .scaleEffect(isPulsing ? 1.045 : 1)
                    .opacity(isPulsing ? 0.82 : 1)
            }

            Group {
                if let urlString = channel.profileImageUrl, let url = URL(string: urlString) {
                    KFImage(url)
                        .resizable()
                        .aspectRatio(contentMode: .fill)
                } else {
                    Circle()
                        .fill(Color(hex: channel.themeColor).opacity(0.16))
                        .overlay {
                            Text(channel.name.prefix(1))
                                .font(.title2.weight(.bold))
                                .foregroundStyle(Color(hex: channel.themeColor))
                        }
                }
            }
            .frame(width: 88, height: 88)
            .clipShape(Circle())
            .overlay {
                Circle().stroke(Color(.systemBackground), lineWidth: 3)
            }
        }
        .frame(width: 96, height: 96)
        .shadow(color: isLive ? ChannelNativePalette.huyeorAmber.opacity(0.3) : .black.opacity(0.12), radius: 10, y: 4)
        .onAppear {
            guard isLive else { return }
            withAnimation(.easeInOut(duration: 1.15).repeatForever(autoreverses: true)) {
                isPulsing = true
            }
        }
        .onChange(of: isLive) { live in
            if !live {
                isPulsing = false
            }
        }
        .accessibilityLabel(isLive ? "\(channel.name), 라이브 중" : channel.name)
    }
}

struct ChannelSectionRail: View {
    /// feature-settings 기반 동적 탭 목록 (순서/라벨/노출 반영)
    let tabs: [ChannelDetailView.ChannelResolvedTab]
    @Binding var selectedTab: ChannelDetailView.ChannelTab
    var onSelect: ((ChannelDetailView.ChannelTab) -> Void)?

    private let primaryTint = Color.accentColor

    var body: some View {
        ScrollViewReader { proxy in
            ScrollView(.horizontal, showsIndicators: false) {
                HStack(spacing: 7) {
                    ForEach(tabs) { resolved in
                        Button {
                            select(resolved.tab)
                        } label: {
                            sectionLabel(
                                title: resolved.label,
                                icon: resolved.icon,
                                isSelected: selectedTab == resolved.tab
                            )
                        }
                        .buttonStyle(.plain)
                        .contentShape(Capsule())
                        .accessibilityAddTraits(selectedTab == resolved.tab ? .isSelected : [])
                        .id(resolved.tab)
                    }
                }
                .padding(.horizontal, 20)
                .padding(.vertical, 8)
            }
            .onAppear {
                proxy.scrollTo(selectedTab, anchor: .center)
            }
            .onChange(of: selectedTab) { tab in
                withAnimation(.easeInOut(duration: 0.28)) {
                    proxy.scrollTo(tab, anchor: .center)
                }
            }
        }
        .background(Color.clear)
    }

    private func select(_ tab: ChannelDetailView.ChannelTab) {
        withAnimation(.easeInOut(duration: 0.28)) {
            selectedTab = tab
        }
        onSelect?(tab)
    }

    @ViewBuilder
    private func sectionLabel(
        title: String,
        icon: String,
        isSelected: Bool
    ) -> some View {
        Label(title, systemImage: icon)
            .font(.subheadline.weight(isSelected ? .bold : .medium))
            .foregroundStyle(isSelected ? primaryTint : Color.secondary)
            .padding(.horizontal, 13)
            .padding(.vertical, 9)
            .frame(minHeight: 44)
            .background(.ultraThinMaterial, in: Capsule())
            .overlay {
                Capsule()
                    .fill(primaryTint.opacity(isSelected ? 0.20 : 0.06))
            }
            .overlay {
                Capsule()
                    .stroke(
                        LinearGradient(
                            colors: [
                                Color.white.opacity(isSelected ? 0.72 : 0.52),
                                primaryTint.opacity(isSelected ? 0.44 : 0.20),
                                Color.primary.opacity(0.05)
                            ],
                            startPoint: .topLeading,
                            endPoint: .bottomTrailing
                        ),
                        lineWidth: isSelected ? 0.9 : 0.6
                    )
            }
            .shadow(
                color: primaryTint.opacity(isSelected ? 0.18 : 0.06),
                radius: isSelected ? 9 : 5,
                y: 3
            )
    }
}

// MARK: - Voice commission

// MARK: - Channel wardrobe

struct ChannelWardrobeView: View {
    @StateObject private var viewModel: ChannelWardrobeViewModel
    @State private var selectedCategoryID: Int?
    @State private var selectedItem: ChannelWardrobeItem?

    init(identifier: String) {
        _viewModel = StateObject(wrappedValue: ChannelWardrobeViewModel(identifier: identifier))
    }

    private let columns = Array(repeating: GridItem(.flexible(), spacing: 2), count: 3)

    private var visibleItems: [ChannelWardrobeItem] {
        guard let selectedCategoryID else { return viewModel.items }
        return viewModel.items.filter { $0.categoryID == selectedCategoryID }
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 16) {
            if !viewModel.categories.isEmpty {
                ScrollView(.horizontal, showsIndicators: false) {
                    HStack(spacing: 8) {
                        Button("전체") { selectedCategoryID = nil }
                            .buttonStyle(.bordered)
                            .tint(selectedCategoryID == nil ? .primary : .secondary)

                        ForEach(viewModel.categories) { category in
                            Button(category.name) { selectedCategoryID = category.id }
                                .buttonStyle(.bordered)
                                .tint(selectedCategoryID == category.id ? .primary : .secondary)
                        }
                    }
                    .padding(.horizontal, 20)
                }
                .padding(.top, 22)
            }

            if viewModel.isLoading && viewModel.items.isEmpty {
                ProgressView()
                    .frame(maxWidth: .infinity)
                    .padding(.top, 64)
            } else if let errorMessage = viewModel.errorMessage, viewModel.items.isEmpty {
                ChannelEmptyState(
                    title: "옷장을 불러올 수 없어요",
                    systemImage: "exclamationmark.triangle",
                    message: errorMessage
                )
                .padding(.top, 48)
            } else if visibleItems.isEmpty {
                ChannelEmptyState(
                    title: "등록된 옷장이 없어요",
                    systemImage: "tshirt",
                    message: "새로운 의상과 이미지가 추가되면 여기에 모아둘게요."
                )
                .padding(.top, 48)
            } else {
                LazyVGrid(columns: columns, spacing: 2) {
                    ForEach(visibleItems) { item in
                        Button { selectedItem = item } label: {
                            ChannelWardrobeGridItem(item: item)
                        }
                        .buttonStyle(.plain)
                        .accessibilityLabel("옷장 항목 \(item.title)")
                    }
                }
            }
        }
        .task { await viewModel.load() }
        .refreshable { await viewModel.load(force: true) }
        .sheet(item: $selectedItem) { item in
            ChannelWardrobeDetailSheet(
                item: item,
                category: viewModel.categories.first { $0.id == item.categoryID }
            )
        }
    }
}

private struct ChannelWardrobeGridItem: View {
    let item: ChannelWardrobeItem

    var body: some View {
        ZStack(alignment: .bottomLeading) {
            KFImage(ChannelEnvironment.imageURL(item.imageURL))
                .placeholder {
                    Rectangle()
                        .fill(Color(.secondarySystemBackground))
                        .overlay { ProgressView() }
                }
                .resizable()
                .scaledToFill()
                .frame(maxWidth: .infinity)
                .aspectRatio(1, contentMode: .fit)
                .clipped()

            LinearGradient(
                colors: [.clear, .black.opacity(0.58)],
                startPoint: .center,
                endPoint: .bottom
            )
            .frame(height: 54)

            Text(item.title)
                .font(.caption2.weight(.semibold))
                .foregroundStyle(.white)
                .lineLimit(1)
                .padding(7)
        }
    }
}

private struct ChannelWardrobeDetailSheet: View {
    @Environment(\.dismiss) private var dismiss

    let item: ChannelWardrobeItem
    let category: ChannelWardrobeCategory?

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(alignment: .leading, spacing: 18) {
                    KFImage(ChannelEnvironment.imageURL(item.imageURL))
                        .placeholder {
                            RoundedRectangle(cornerRadius: 24, style: .continuous)
                                .fill(Color(.secondarySystemBackground))
                                .overlay { ProgressView() }
                        }
                        .resizable()
                        .scaledToFit()
                        .frame(maxWidth: .infinity)
                        .clipShape(RoundedRectangle(cornerRadius: 24, style: .continuous))

                    VStack(alignment: .leading, spacing: 9) {
                        if let category {
                            Text(category.name)
                                .font(.caption.weight(.bold))
                                .foregroundStyle(.secondary)
                        }
                        Text(item.title)
                            .font(.title2.weight(.bold))

                        if let description = item.description?.trimmingCharacters(in: .whitespacesAndNewlines), !description.isEmpty {
                            Text(description)
                                .font(.body)
                                .foregroundStyle(.secondary)
                                .fixedSize(horizontal: false, vertical: true)
                        }

                        if !item.tags.isEmpty {
                            FlowLayout(spacing: 7) {
                                ForEach(item.tags, id: \.self) { tag in
                                    Text("#\(tag)")
                                        .font(.caption.weight(.medium))
                                        .foregroundStyle(.secondary)
                                        .padding(.horizontal, 9)
                                        .padding(.vertical, 6)
                                        .background(Color(.secondarySystemBackground), in: Capsule())
                                }
                            }
                        }
                    }
                }
                .padding(20)
            }
            .navigationTitle("옷장")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .topBarTrailing) {
                    Button("닫기") { dismiss() }
                }
            }
        }
        .presentationDetents([.medium, .large])
    }
}

@MainActor
private final class ChannelWardrobeViewModel: ObservableObject {
    @Published private(set) var categories: [ChannelWardrobeCategory] = []
    @Published private(set) var items: [ChannelWardrobeItem] = []
    @Published private(set) var isLoading = false
    @Published private(set) var errorMessage: String?

    private let identifier: String
    private let repository: ChannelRepository

    init(identifier: String, repository: ChannelRepository = AppClientChannelRepository()) {
        self.identifier = identifier
        self.repository = repository
    }

    func load(force: Bool = false) async {
        guard !isLoading else { return }
        if !force, !items.isEmpty { return }

        isLoading = true
        errorMessage = nil
        defer { isLoading = false }

        do {
            let wardrobe = try await repository.fetchChannelWardrobe(identifier: identifier)
            categories = wardrobe.categories.filter(\.isEnabled)
            items = wardrobe.items
        } catch {
            errorMessage = "잠시 후 다시 시도해 주세요."
        }
    }
}

struct ChannelWardrobeResponse: Decodable {
    let categories: [ChannelWardrobeCategory]
    let items: [ChannelWardrobeItem]
}

struct ChannelWardrobeCategory: Decodable, Identifiable {
    let id: Int
    let name: String
    let defaultAspectRatio: String
    let isEnabled: Bool
    let order: Int
}

struct ChannelWardrobeItem: Decodable, Identifiable {
    let id: Int
    let categoryID: Int
    let title: String
    let imageURL: String
    let description: String?
    let tags: [String]
    let isVisible: Bool
    let order: Int
    let createdAt: String
    let updatedAt: String

    private enum CodingKeys: String, CodingKey {
        case id
        case categoryID = "categoryId"
        case title
        case imageURL = "imageUrl"
        case description
        case tags
        case isVisible
        case order
        case createdAt
        case updatedAt
    }
}

private enum ChannelNativePalette {
    static let huyeorAmber = Color(red: 0.96, green: 0.37, blue: 0.04)
    static let paleAmber = Color(red: 1.0, green: 0.94, blue: 0.86)
}
