import SwiftUI
import Kingfisher

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

