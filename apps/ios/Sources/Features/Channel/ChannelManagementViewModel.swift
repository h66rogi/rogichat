import Foundation

@MainActor
final class ChannelManagementViewModel: ObservableObject {
    let channelId: Int
    private let repository: ChannelRepository

    @Published var categories: [Category] = []
    @Published var isLoading = false
    @Published var error: Error?

    // Form state
    @Published var formName = ""
    @Published var formColor: String
    @Published var editingCategory: Category?
    @Published var showCategoryForm = false

    // Delete state
    @Published var categoryToDelete: Category?
    @Published var showDeleteConfirmation = false

    static let presetColors: [String] = [
        "#FF6B6B", "#FF8E53", "#FFC93C", "#6BCB77",
        "#4D96FF", "#9B59B6", "#FF69B4", "#00CEC9",
        "#636E72", "#2D3436", "#E17055", "#0984E3"
    ]

    init(channelId: Int, repository: ChannelRepository = AppClientChannelRepository()) {
        self.channelId = channelId
        self.repository = repository
        self.formColor = Self.presetColors[0]
    }

    func loadCategories() async {
        isLoading = true
        defer { isLoading = false }

        do {
            let loaded = try await repository.fetchCategoriesManage(channelId: channelId)
            categories = Self.sortCategories(loaded)
        } catch {
            self.error = error
        }
    }

    /// displayOrder 내림차순 정렬 (높은 값이 위에), 같으면 이름순
    private static func sortCategories(_ categories: [Category]) -> [Category] {
        categories.sorted { a, b in
            let orderA = a.displayOrder ?? Int.min
            let orderB = b.displayOrder ?? Int.min
            if orderA != orderB {
                return orderA > orderB
            }
            return a.name.localizedCompare(b.name) == .orderedAscending
        }
    }

    func showAddForm() {
        editingCategory = nil
        formName = ""
        formColor = Self.presetColors[0]
        showCategoryForm = true
    }

    func showEditForm(category: Category) {
        editingCategory = category
        formName = category.name
        formColor = category.color ?? Self.presetColors[0]
        showCategoryForm = true
    }

    func createCategory() async {
        let name = formName.trimmingCharacters(in: .whitespaces)
        guard !name.isEmpty else { return }

        do {
            let newCategory = try await repository.createCategory(
                channelId: channelId, name: name, color: formColor
            )
            categories.append(newCategory)
        } catch {
            self.error = error
        }
    }

    func updateCategory() async {
        guard let editing = editingCategory else { return }
        let name = formName.trimmingCharacters(in: .whitespaces)
        guard !name.isEmpty else { return }

        do {
            let updated = try await repository.updateCategory(
                channelId: channelId,
                categoryId: editing.id,
                name: name,
                color: formColor,
                displayOrder: editing.displayOrder
            )
            if let index = categories.firstIndex(where: { $0.id == editing.id }) {
                categories[index] = updated
            }
        } catch {
            self.error = error
        }
    }

    func deleteCategory(_ category: Category) async {
        do {
            try await repository.deleteCategory(channelId: channelId, categoryId: category.id)
            categories.removeAll { $0.id == category.id }
        } catch {
            self.error = error
        }
    }

    /// Android/Frontend와 동일한 reorder 로직:
    /// 각 카테고리를 개별 PUT으로 displayOrder 갱신
    func moveCategories(from source: IndexSet, to destination: Int) {
        // 1. 로컬 즉시 반영 (optimistic)
        categories.move(fromOffsets: source, toOffset: destination)

        let reordered = categories
        Task {
            // 2. displayOrder 계산 (Android/Frontend 동일 알고리즘)
            let maxExistingOrder = reordered
                .compactMap { $0.displayOrder }
                .filter { $0 > 0 }
                .max() ?? 0

            let startOrder = maxExistingOrder > 0
                ? maxExistingOrder + 1
                : reordered.count * 100

            // 3. 각 카테고리를 개별 PUT으로 업데이트
            var failCount = 0
            for (index, category) in reordered.enumerated() {
                let newDisplayOrder = startOrder - index
                do {
                    _ = try await repository.updateCategory(
                        channelId: channelId,
                        categoryId: category.id,
                        name: category.name,
                        color: category.color ?? "#6B7280",
                        displayOrder: newDisplayOrder
                    )
                } catch {
                    failCount += 1
                }
            }

            // 4. 서버 상태로 다시 로드
            await loadCategories()

            if failCount == reordered.count {
                self.error = ChannelAPIError.clientError(statusCode: 400, message: "순서 변경에 실패했습니다")
            }
        }
    }
}
