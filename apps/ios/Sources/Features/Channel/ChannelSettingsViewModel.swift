import Foundation

@MainActor
final class ChannelSettingsViewModel: ObservableObject {
    let channelId: Int
    let identifier: String
    private let repository: ChannelRepository

    @Published var isLoading = true
    @Published var isSaving = false
    @Published var name = ""
    @Published var profileImageUrl: String?
    @Published var links: [EditableLink] = []
    @Published var themeColor = "#6366f1"
    @Published var isUploadingImage = false
    @Published var showError = false
    @Published var errorMessage = ""

    // Preserved fields (not editable but needed for PUT)
    private var originalWebPath = ""
    private var originalVisibility: String?
    private var originalChannelDescription: String?

    init(channelId: Int, identifier: String, repository: ChannelRepository = AppClientChannelRepository()) {
        self.channelId = channelId
        self.identifier = identifier
        self.repository = repository
    }

    func loadChannel() async {
        isLoading = true
        defer { isLoading = false }

        do {
            let channel = try await repository.fetchChannelDetail(identifier: identifier)
            name = channel.name
            profileImageUrl = channel.profileImageUrl
            links = (channel.additionalLinks ?? []).map { EditableLink(name: $0.name, url: $0.url) }
            themeColor = channel.themeColor ?? "#6366f1"
            originalWebPath = channel.webPath
            originalChannelDescription = channel.channelDescription
            originalVisibility = channel.visibility
        } catch {
            showErrorMessage("채널 정보를 불러오는데 실패했습니다")
        }
    }

    func uploadImage(imageData: Data, fileName: String, mimeType: String) async {
        isUploadingImage = true
        defer { isUploadingImage = false }

        do {
            let response = try await repository.uploadImage(imageData: imageData, fileName: fileName, mimeType: mimeType)
            profileImageUrl = response.imageUrl
        } catch {
            showErrorMessage("이미지 업로드에 실패했습니다")
        }
    }

    func save() async -> Bool {
        let trimmedName = name.trimmingCharacters(in: .whitespaces)
        guard !trimmedName.isEmpty else {
            showErrorMessage("채널 이름을 입력해주세요")
            return false
        }

        isSaving = true
        defer { isSaving = false }

        let validLinks = links
            .filter { !$0.name.trimmingCharacters(in: .whitespaces).isEmpty && !$0.url.trimmingCharacters(in: .whitespaces).isEmpty }
            .map { ChannelLink(name: $0.name.trimmingCharacters(in: .whitespaces), url: $0.url.trimmingCharacters(in: .whitespaces)) }

        guard let visibility = originalVisibility, ["PUBLIC", "UNLISTED"].contains(visibility) else {
            showErrorMessage("채널 정보를 다시 불러와 주세요.")
            return false
        }
        let body = UpdateChannelRequestBody(
            name: trimmedName,
            webPath: originalWebPath,
            profileImageUrl: profileImageUrl,
            additionalLinks: validLinks,
            themeColor: themeColor,
            channelDescription: originalChannelDescription ?? "",
            visibility: visibility
        )

        do {
            _ = try await repository.updateChannel(identifier: identifier, body: body)
            return true
        } catch {
            showErrorMessage("저장에 실패했습니다")
            return false
        }
    }

    private func showErrorMessage(_ message: String) {
        errorMessage = message
        showError = true
    }
}
